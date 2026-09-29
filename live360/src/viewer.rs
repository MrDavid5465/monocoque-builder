//! One fullscreen window per screen, each showing a rectilinear slice of the
//! captured equirectangular frame, together forming one continuous view.
//!
//! Everything runs on one thread with one GL context: the texture is
//! imported once and every window samples it. The loop waits on PipeWire for
//! the next frame and redraws all windows once per frame, swapping without
//! vsync — waiting for vsync on each window in turn would divide the rate by
//! the number of screens, and the compositor already presents without
//! tearing. Drawing on arrival is also what keeps latency down.
//!
//! Each frame's buffer goes back to the compositor as soon as the GPU has
//! finished reading it for every screen — never earlier, so it can't be
//! overwritten mid-read, and never later, so the compositor isn't left
//! without a buffer to draw the next frame into.

use std::ffi::CString;
use std::num::NonZeroU32;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use glow::HasContext;
use glutin::config::{ColorBufferType, Config, ConfigTemplateBuilder, GlConfig};
use glutin::context::{
    ContextApi, ContextAttributesBuilder, NotCurrentGlContext, PossiblyCurrentContext,
    PossiblyCurrentGlContext, Version,
};
use glutin::display::{AsRawDisplay, GetGlDisplay, GlDisplay, RawDisplay};
use glutin::surface::{GlSurface, Surface, SwapInterval, WindowSurface};
use glutin_winit::{DisplayBuilder, GlWindow};
use raw_window_handle::HasWindowHandle;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::monitor::MonitorHandle;
use winit::window::{Fullscreen, Window, WindowAttributes, WindowId};

use crate::capture::Capture;
use crate::import::Importer;

/// Where the whole rig looks, in degrees. Yaw is positive to the right,
/// pitch positive up; `fov` is each screen's horizontal field of view.
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub yaw: f32,
    pub pitch: f32,
    pub fov: f32,
}

pub struct Options {
    /// Outputs left to right, e.g. `DP-3,DP-1,DP-2`. Empty = one ordinary
    /// window, for development.
    pub screens: Vec<String>,
    /// Angle between neighbouring screens' centres, as seen from the seat.
    /// `None` = the field of view, which makes the slices meet edge to edge.
    pub angle: Option<f32>,
    pub view: View,
}

const VERTEX: &str = r#"#version 300 es
out vec2 ndc;
void main() {
    // One triangle covering the screen: ids 0,1,2 -> (-1,-1), (3,-1), (-1,3).
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    ndc = p * 2.0 - 1.0;
    gl_Position = vec4(ndc, 0.0, 1.0);
}
"#;

const FRAGMENT: &str = r#"#version 300 es
precision highp float;
in vec2 ndc;
out vec4 color;
uniform sampler2D equirect;
uniform float yaw;
uniform float pitch;
uniform float tan_half_fov;
uniform float aspect;
const float PI = 3.14159265358979;
void main() {
    // Ray through this pixel for a camera looking down -z.
    vec3 d = normalize(vec3(ndc.x * tan_half_fov, ndc.y * tan_half_fov / aspect, -1.0));
    // Pitch about x (positive looks up), then yaw about y (positive right).
    float cp = cos(pitch), sp = sin(pitch);
    d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
    float cy = cos(yaw), sy = sin(yaw);
    d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
    // Equirectangular: longitude across, latitude down; forward is the
    // centre of the image, the top row is straight up.
    float lon = atan(d.x, -d.z);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);
    color = vec4(texture(equirect, uv).rgb, 1.0);
}
"#;

/// One screen's window and where it sits in the rig.
struct Screen {
    window: Window,
    surface: Surface<WindowSurface>,
    /// Offset from the rig's yaw, in screens: -1, 0, 1 for a triple.
    slot: f32,
}

struct Gl {
    screens: Vec<Screen>,
    context: PossiblyCurrentContext,
    gl: glow::Context,
    program: glow::Program,
    vao: glow::VertexArray,
    importer: Importer,
}

struct App {
    options: Options,
    view: View,
    capture: Capture,
    gl: Option<Gl>,
    drawn: u64,
    last_report: Instant,
    error: Option<anyhow::Error>,
}

pub fn run(capture: Capture, options: Options) -> Result<()> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(ControlFlow::Poll);
    let mut app = App {
        view: options.view,
        options,
        capture,
        gl: None,
        drawn: 0,
        last_report: Instant::now(),
        error: None,
    };
    event_loop.run_app(&mut app)?;
    match app.error {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

fn attributes(monitor: Option<MonitorHandle>) -> WindowAttributes {
    let attributes = Window::default_attributes().with_title("Live 360");
    match monitor {
        Some(m) => attributes.with_fullscreen(Some(Fullscreen::Borderless(Some(m)))),
        None => attributes,
    }
}

fn surface_for(config: &Config, window: &Window) -> Result<Surface<WindowSurface>> {
    let attributes = window
        .build_surface_attributes(Default::default())
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(unsafe {
        config
            .display()
            .create_window_surface(config, &attributes)
            .context("creating a window surface")?
    })
}

impl App {
    fn create(&mut self, event_loop: &ActiveEventLoop) -> Result<Gl> {
        let monitors: Vec<MonitorHandle> = event_loop.available_monitors().collect();
        let names: Vec<String> = monitors.iter().filter_map(|m| m.name()).collect();
        eprintln!("outputs: {}", names.join(", "));
        let targets: Vec<Option<MonitorHandle>> = if self.options.screens.is_empty() {
            vec![None]
        } else {
            self.options
                .screens
                .iter()
                .map(|wanted| {
                    monitors
                        .iter()
                        .find(|m| m.name().as_deref() == Some(wanted.as_str()))
                        .cloned()
                        .map(Some)
                        .with_context(|| format!("no output named {wanted}"))
                })
                .collect::<Result<_>>()?
        };

        // The first window comes with the GL config; the rest reuse it.
        let (first, config) = DisplayBuilder::new()
            .with_window_attributes(Some(attributes(targets[0].clone())))
            .build(event_loop, ConfigTemplateBuilder::new(), |configs| {
                // Plain 8-bit RGB, no MSAA: a fullscreen triangle sampling a
                // texture needs nothing more.
                let configs: Vec<_> = configs.collect();
                configs
                    .iter()
                    .find(|c| {
                        c.color_buffer_type()
                            == Some(ColorBufferType::Rgb {
                                r_size: 8,
                                g_size: 8,
                                b_size: 8,
                            })
                            && c.num_samples() == 0
                    })
                    .cloned()
                    .unwrap_or_else(|| configs[0].clone())
            })
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let first = first.context("no window was created")?;
        let display = config.display();
        let context = unsafe {
            display
                .create_context(
                    &config,
                    &ContextAttributesBuilder::new()
                        .with_context_api(ContextApi::Gles(Some(Version::new(3, 0))))
                        .build(Some(first.window_handle()?.as_raw())),
                )
                .context("creating the GL context")?
        };

        let count = targets.len();
        let centre = (count as f32 - 1.0) / 2.0;
        let mut windows = vec![first];
        for target in targets.into_iter().skip(1) {
            windows.push(
                glutin_winit::finalize_window(event_loop, attributes(target), &config)
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
            );
        }
        let mut screens = Vec::with_capacity(count);
        for (i, window) in windows.into_iter().enumerate() {
            let surface = surface_for(&config, &window)?;
            screens.push(Screen {
                window,
                surface,
                slot: i as f32 - centre,
            });
        }

        let context = context
            .make_current(&screens[0].surface)
            .context("making the context current")?;
        for screen in &screens {
            context.make_current(&screen.surface)?;
            // No vsync wait: pacing comes from frame arrival (see module doc).
            screen
                .surface
                .set_swap_interval(&context, SwapInterval::DontWait)?;
        }

        let gl = unsafe {
            glow::Context::from_loader_function_cstr(|name| display.get_proc_address(name))
        };
        let RawDisplay::Egl(egl_display) = display.raw_display() else {
            anyhow::bail!("DMA-BUF import needs an EGL display");
        };
        let importer = Importer::new(egl_display, |name| {
            let name = CString::new(name).expect("static name");
            display.get_proc_address(&name)
        })?;

        let (program, vao) = unsafe {
            let program = gl.create_program().map_err(anyhow::Error::msg)?;
            for (kind, source) in [
                (glow::VERTEX_SHADER, VERTEX),
                (glow::FRAGMENT_SHADER, FRAGMENT),
            ] {
                let shader = gl.create_shader(kind).map_err(anyhow::Error::msg)?;
                gl.shader_source(shader, source);
                gl.compile_shader(shader);
                if !gl.get_shader_compile_status(shader) {
                    anyhow::bail!("shader: {}", gl.get_shader_info_log(shader));
                }
                gl.attach_shader(program, shader);
            }
            gl.link_program(program);
            if !gl.get_program_link_status(program) {
                anyhow::bail!("link: {}", gl.get_program_info_log(program));
            }
            (
                program,
                gl.create_vertex_array().map_err(anyhow::Error::msg)?,
            )
        };
        eprintln!("viewer up: {count} screen(s), {:?}", self.view);
        Ok(Gl {
            screens,
            context,
            gl,
            program,
            vao,
            importer,
        })
    }

    /// Waits briefly for a frame; if one came, draws every screen.
    fn tick(&mut self) -> Result<()> {
        self.capture.pump(Duration::from_millis(20));
        self.capture.check()?;
        let Some(format) = self.capture.negotiated() else {
            return Ok(());
        };
        let Some(gl) = &mut self.gl else {
            return Ok(());
        };
        let Some(frame) = self.capture.take_newest() else {
            self.report();
            return Ok(());
        };
        let texture = gl
            .importer
            .texture(&gl.gl, &format, frame.fd, frame.offset, frame.stride)?;

        let angle = self.options.angle.unwrap_or(self.view.fov);
        for screen in &gl.screens {
            gl.context.make_current(&screen.surface)?;
            let size = screen.window.inner_size();
            unsafe {
                let g = &gl.gl;
                g.viewport(0, 0, size.width as i32, size.height as i32);
                g.use_program(Some(gl.program));
                g.bind_vertex_array(Some(gl.vao));
                g.active_texture(glow::TEXTURE0);
                g.bind_texture(glow::TEXTURE_2D, Some(texture));
                let uniform = |name| g.get_uniform_location(gl.program, name);
                g.uniform_1_i32(uniform("equirect").as_ref(), 0);
                g.uniform_1_f32(
                    uniform("yaw").as_ref(),
                    (self.view.yaw + screen.slot * angle).to_radians(),
                );
                g.uniform_1_f32(uniform("pitch").as_ref(), self.view.pitch.to_radians());
                g.uniform_1_f32(
                    uniform("tan_half_fov").as_ref(),
                    (self.view.fov.to_radians() / 2.0).tan(),
                );
                g.uniform_1_f32(
                    uniform("aspect").as_ref(),
                    size.width as f32 / size.height.max(1) as f32,
                );
                g.draw_arrays(glow::TRIANGLES, 0, 3);
            }
            screen.surface.swap_buffers(&gl.context)?;
        }
        // Give the buffer back as soon as the GPU has read it, rather than
        // holding it until the next frame: each window's own swapchain keeps
        // showing the image. With only two capture buffers, holding one
        // meant the compositor often had nowhere to write the next frame,
        // which cost about 9 of AC's 50 fps.
        unsafe {
            if let Ok(fence) = gl.gl.fence_sync(glow::SYNC_GPU_COMMANDS_COMPLETE, 0) {
                gl.gl
                    .client_wait_sync(fence, glow::SYNC_FLUSH_COMMANDS_BIT, 100_000_000);
                gl.gl.delete_sync(fence);
            }
        }
        self.capture.release(frame);
        self.drawn += 1;
        self.report();
        Ok(())
    }

    fn report(&mut self) {
        if self.last_report.elapsed() >= Duration::from_secs(1) {
            println!(
                "received {:>3}/s  drawn {:>3}/s  yaw {:.0} pitch {:.0} fov {:.0} angle {:.0}",
                self.capture.take_received(),
                self.drawn,
                self.view.yaw,
                self.view.pitch,
                self.view.fov,
                self.options.angle.unwrap_or(self.view.fov),
            );
            self.drawn = 0;
            self.last_report = Instant::now();
        }
    }

    fn fail(&mut self, event_loop: &ActiveEventLoop, error: anyhow::Error) {
        self.error = Some(error);
        event_loop.exit();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gl.is_none() {
            // Capture first. The compositor's two 8K buffers are 256 MB of
            // VRAM next to a game already using most of it; when fullscreen
            // windows allocated their own first, that allocation failed and
            // the stream died ("no more input formats").
            if let Err(e) = self.capture.wait_for_first_frame(Duration::from_secs(10)) {
                return self.fail(event_loop, e);
            }
            match self.create(event_loop) {
                Ok(gl) => self.gl = Some(gl),
                Err(e) => self.fail(event_loop, e),
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gl) = &self.gl {
                    let screen = gl.screens.iter().find(|s| s.window.id() == id);
                    if let (Some(screen), Some(w), Some(h)) = (
                        screen,
                        NonZeroU32::new(size.width),
                        NonZeroU32::new(size.height),
                    ) {
                        screen.surface.resize(&gl.context, w, h);
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                let step = 1.0;
                match event.logical_key {
                    Key::Named(NamedKey::Escape) => event_loop.exit(),
                    Key::Named(NamedKey::ArrowLeft) => self.view.yaw -= step,
                    Key::Named(NamedKey::ArrowRight) => self.view.yaw += step,
                    Key::Named(NamedKey::ArrowUp) => self.view.pitch += step,
                    Key::Named(NamedKey::ArrowDown) => self.view.pitch -= step,
                    Key::Character(ref c) if c == "+" || c == "=" => {
                        self.view.fov = (self.view.fov - step).max(10.0)
                    }
                    Key::Character(ref c) if c == "-" => {
                        self.view.fov = (self.view.fov + step).min(170.0)
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.gl.is_some()
            && let Err(e) = self.tick()
        {
            self.fail(event_loop, e);
        }
    }

    fn exiting(&mut self, _: &ActiveEventLoop) {
        if let Some(gl) = &mut self.gl {
            gl.importer.clear(&gl.gl);
        }
    }
}
