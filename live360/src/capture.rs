//! The capture half: the ScreenCast portal picks the AC window, and a
//! PipeWire stream receives its frames as DMA-BUFs — GPU memory, never
//! copied. Shared by the probe and the viewer.
//!
//! Frames are handed out by raw buffer and must be given back with
//! [`Capture::release`] once the GPU is done reading them. With only two
//! buffers in flight (see `BUFFERS`), holding one is what stops the
//! compositor writing into the frame being drawn.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use ashpd::desktop::PersistMode;
use ashpd::desktop::screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType};
use pipewire as pw;
use pw::spa;
use pw::spa::pod::Pod;

use crate::egl;

/// Where the portal's restore token is kept, so the window is picked once and
/// later runs reconnect to it without a dialog.
/// What the portal captures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// The AC window itself. Needs the window to be exactly ≤ 8192 wide in
    /// physical pixels, which fractional display scaling breaks.
    Window,
    /// A virtual monitor that exists only for the capture. AC is moved onto
    /// it, and it has its own scale, independent of the real screens.
    Virtual,
}

pub fn token_path_for(source: Source) -> PathBuf {
    let base = token_path();
    match source {
        Source::Window => base,
        Source::Virtual => base.with_file_name("live360-restore-token-virtual"),
    }
}

pub fn token_path() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dashboard-designer")
        .join("live360-restore-token")
}

struct Portal {
    node_id: u32,
    size: Option<(i32, i32)>,
    fd: std::os::fd::OwnedFd,
}

/// Asks the portal for one window and returns its PipeWire node plus the
/// remote to reach it on. The session has to outlive the stream, so the
/// caller keeps the runtime (and with it the session) alive.
async fn open_portal(forget: bool, source: Source) -> Result<(Portal, Box<dyn std::any::Any>)> {
    let path = token_path_for(source);
    let token = if forget {
        None
    } else {
        std::fs::read_to_string(&path).ok()
    };

    let proxy = Screencast::new()
        .await
        .context("ScreenCast portal unavailable")?;
    let session = proxy.create_session(Default::default()).await?;
    proxy
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_cursor_mode(CursorMode::Hidden)
                .set_sources(enumflags2::BitFlags::from(match source {
                    Source::Window => SourceType::Window,
                    Source::Virtual => SourceType::Virtual,
                }))
                .set_multiple(false)
                .set_persist_mode(PersistMode::ExplicitlyRevoked)
                .set_restore_token(token.as_deref().map(str::trim)),
        )
        .await?;
    let response = proxy
        .start(&session, None, Default::default())
        .await?
        .response()
        .context("the window picker was cancelled")?;

    if let Some(new_token) = response.restore_token() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        std::fs::write(&path, new_token).ok();
    }
    let Some(stream) = response.streams().first() else {
        bail!("the portal returned no stream");
    };
    let portal = Portal {
        node_id: stream.pipe_wire_node_id(),
        size: stream.size(),
        fd: proxy
            .open_pipe_wire_remote(&session, Default::default())
            .await?,
    };
    Ok((portal, Box::new((proxy, session))))
}

use pw::spa::param::format::{FormatProperties, MediaSubtype, MediaType};
use pw::spa::param::video::VideoFormat;
use pw::spa::pod::{ChoiceValue, Object, Property, PropertyFlags, Value};
use pw::spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle, SpaTypes};

/// Formats offered, in preference order. KWin renders windows as BGRx.
const FORMATS: [VideoFormat; 2] = [VideoFormat::BGRx, VideoFormat::BGRA];

fn serialize(object: Object) -> Vec<u8> {
    pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &Value::Object(object),
    )
    .expect("format pod serialises")
    .0
    .into_inner()
}

fn prop(key: FormatProperties, value: Value) -> Property {
    Property {
        key: key.as_raw(),
        flags: PropertyFlags::empty(),
        value,
    }
}

/// One EnumFormat. With `modifiers`, it offers DMA-BUF in those layouts —
/// left unfixed (DONT_FIXATE) so the producer can say which of them it can
/// allocate, and we pick. Without, it's the shared-memory fallback.
fn format_pod(format: VideoFormat, modifiers: Option<&[u64]>) -> Vec<u8> {
    let mut properties = vec![
        prop(
            FormatProperties::MediaType,
            Value::Id(Id(MediaType::Video.as_raw())),
        ),
        prop(
            FormatProperties::MediaSubtype,
            Value::Id(Id(MediaSubtype::Raw.as_raw())),
        ),
        prop(
            FormatProperties::VideoFormat,
            Value::Id(Id(format.as_raw())),
        ),
    ];
    if let Some(&[fixed]) = modifiers {
        // Fixation reply: exactly the modifier we picked.
        properties.push(Property {
            key: FormatProperties::VideoModifier.as_raw(),
            flags: PropertyFlags::MANDATORY,
            value: Value::Long(fixed as i64),
        });
    } else if let Some(modifiers) = modifiers {
        let as_i64: Vec<i64> = modifiers.iter().map(|&m| m as i64).collect();
        properties.push(Property {
            key: FormatProperties::VideoModifier.as_raw(),
            flags: PropertyFlags::MANDATORY | PropertyFlags::DONT_FIXATE,
            value: Value::Choice(ChoiceValue::Long(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Enum {
                    default: as_i64[0],
                    alternatives: as_i64,
                },
            ))),
        });
    }
    properties.push(prop(
        FormatProperties::VideoSize,
        Value::Choice(ChoiceValue::Rectangle(Choice(
            ChoiceFlags::empty(),
            ChoiceEnum::Range {
                default: Rectangle {
                    width: 8192,
                    height: 4096,
                },
                min: Rectangle {
                    width: 1,
                    height: 1,
                },
                max: Rectangle {
                    width: 16384,
                    height: 16384,
                },
            },
        ))),
    ));
    properties.push(prop(
        FormatProperties::VideoFramerate,
        Value::Choice(ChoiceValue::Fraction(Choice(
            ChoiceFlags::empty(),
            ChoiceEnum::Range {
                default: Fraction { num: 60, denom: 1 },
                min: Fraction { num: 0, denom: 1 },
                max: Fraction {
                    num: 1000,
                    denom: 1,
                },
            },
        ))),
    ));
    serialize(Object {
        type_: SpaTypes::ObjectParamFormat.as_raw(),
        id: pw::spa::param::ParamType::EnumFormat.as_raw(),
        properties,
    })
}

/// How many buffers the stream keeps.
const BUFFERS: i32 = 2;

/// Tells the producer which kind of memory to hand over.
fn buffers_pod(dmabuf: bool) -> Vec<u8> {
    use pw::spa::sys;
    let types = if dmabuf {
        1 << sys::SPA_DATA_DmaBuf
    } else {
        (1 << sys::SPA_DATA_MemFd) | (1 << sys::SPA_DATA_MemPtr)
    };
    serialize(Object {
        type_: SpaTypes::ObjectParamBuffers.as_raw(),
        id: pw::spa::param::ParamType::Buffers.as_raw(),
        properties: vec![
            Property {
                key: sys::SPA_PARAM_BUFFERS_dataType,
                flags: PropertyFlags::empty(),
                value: Value::Choice(ChoiceValue::Int(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Flags {
                        default: types,
                        flags: vec![types],
                    },
                ))),
            },
            // Each 8K buffer is 128 MB of VRAM next to a game that already
            // wants most of it. Allocations beyond two have been seen to
            // fail, and the compositor then cycles empty buffers into the
            // stream, so ask for exactly a front and a back.
            Property {
                key: sys::SPA_PARAM_BUFFERS_buffers,
                flags: PropertyFlags::empty(),
                value: Value::Choice(ChoiceValue::Int(Choice(
                    ChoiceFlags::empty(),
                    ChoiceEnum::Range {
                        default: BUFFERS,
                        min: BUFFERS,
                        max: BUFFERS,
                    },
                ))),
            },
        ],
    })
}

/// The modifier property of a negotiated format: `None` for shared memory,
/// otherwise every modifier the producer left open (one, once fixated).
fn negotiated_modifiers(param: &Pod) -> Option<Vec<u64>> {
    let (_, value) =
        pw::spa::pod::deserialize::PodDeserializer::deserialize_any_from(param.as_bytes()).ok()?;
    let Value::Object(object) = value else {
        return None;
    };
    let property = object
        .properties
        .into_iter()
        .find(|p| p.key == FormatProperties::VideoModifier.as_raw())?;
    Some(match property.value {
        Value::Long(m) => vec![m as u64],
        Value::Choice(ChoiceValue::Long(Choice(_, choice))) => match choice {
            ChoiceEnum::None(m) => vec![m as u64],
            ChoiceEnum::Enum { alternatives, .. } => {
                alternatives.into_iter().map(|m| m as u64).collect()
            }
            _ => return None,
        },
        _ => return None,
    })
}

/// The negotiated stream, once PipeWire has settled on one.
#[derive(Clone, Copy, Debug)]
pub struct Negotiated {
    pub width: u32,
    pub height: u32,
    pub fourcc: u32,
    /// `None` when the compositor fell back to shared memory, which the
    /// viewer can't use.
    pub modifier: Option<u64>,
}

/// One received frame, held until [`Capture::release`].
pub struct Frame {
    raw: *mut pw::sys::pw_buffer,
    pub fd: i32,
    pub offset: u32,
    pub stride: i32,
}

#[derive(Default)]
struct Shared {
    negotiated: Option<Negotiated>,
    /// Newest frame not yet taken. Older ones are handed straight back.
    pending: Option<*mut pw::sys::pw_buffer>,
    received: u64,
    /// Buffers that arrived without content (no memory or empty chunk).
    empty: u64,
    /// Set if the stream failed; it doesn't recover by itself.
    error: Option<String>,
}

pub struct Capture {
    // Field order is drop order: the stream goes before the loop it runs on,
    // and the portal session outlives both.
    _listener: pw::stream::StreamListener<Rc<RefCell<Shared>>>,
    stream: pw::stream::StreamRc,
    _context: pw::context::ContextRc,
    mainloop: pw::main_loop::MainLoopRc,
    shared: Rc<RefCell<Shared>>,
    _session: Box<dyn std::any::Any>,
    _runtime: tokio::runtime::Runtime,
}

impl Capture {
    /// Opens the portal (reusing the saved window unless `pick`) and
    /// connects to its stream, offering only what `gpu` can import.
    pub fn open(pick: bool, source: Source, gpu: &egl::Gpu) -> Result<Self> {
        let runtime = tokio::runtime::Runtime::new()?;
        let (portal, session) = runtime.block_on(open_portal(pick, source))?;
        eprintln!("capturing node {} ({:?})", portal.node_id, portal.size);

        pw::init();
        let mainloop = pw::main_loop::MainLoopRc::new(None)?;
        let context = pw::context::ContextRc::new(&mainloop, None)?;
        let core = context.connect_fd_rc(portal.fd, None)?;
        let stream = pw::stream::StreamRc::new(
            core,
            "live360",
            pw::properties::properties! {
                *pw::keys::MEDIA_TYPE => "Video",
                *pw::keys::MEDIA_CATEGORY => "Capture",
                *pw::keys::MEDIA_ROLE => "Screen",
            },
        )?;

        let offered: Vec<(VideoFormat, Vec<u64>)> = FORMATS
            .iter()
            .map(|&f| {
                (
                    f,
                    egl::drm_fourcc(f)
                        .map(|c| gpu.modifiers(c))
                        .unwrap_or_default(),
                )
            })
            .collect();

        let shared = Rc::new(RefCell::new(Shared::default()));
        let supported = offered.clone();
        let listener = stream
            .add_local_listener_with_user_data(shared.clone())
            .state_changed(|_, shared, old, new| {
                eprintln!("stream: {old:?} -> {new:?}");
                if let pw::stream::StreamState::Error(e) = new {
                    shared.borrow_mut().error = Some(e);
                }
            })
            .param_changed(move |stream, shared, id, param| {
                let Some(param) = param else { return };
                if id != pw::spa::param::ParamType::Format.as_raw() {
                    return;
                }
                let mut info = pw::spa::param::video::VideoInfoRaw::default();
                if info.parse(param).is_err() {
                    return;
                }
                let format = info.format();
                let negotiated = |modifier| Negotiated {
                    width: info.size().width,
                    height: info.size().height,
                    fourcc: egl::drm_fourcc(format).unwrap_or(0),
                    modifier,
                };
                let reply = match negotiated_modifiers(param) {
                    // Several left open: pick one we can import and answer
                    // with only that. The fixed format comes back through
                    // the arm below.
                    Some(open) if open.len() > 1 => {
                        let ours = supported
                            .iter()
                            .find(|(f, _)| *f == format)
                            .map(|(_, m)| m.clone())
                            .unwrap_or_default();
                        let Some(&chosen) = open.iter().find(|m| ours.contains(m)) else {
                            eprintln!("no common modifier for {format:?}");
                            return;
                        };
                        format_pod(format, Some(&[chosen]))
                    }
                    Some(fixed) => {
                        let n = negotiated(Some(fixed[0]));
                        eprintln!(
                            "negotiated {format:?} {}x{} modifier {:#x}",
                            n.width, n.height, fixed[0]
                        );
                        shared.borrow_mut().negotiated = Some(n);
                        buffers_pod(true)
                    }
                    None => {
                        eprintln!(
                            "the compositor only offered shared memory ({}x{}) — too slow to use; \
                             see the 8192-wide limit and display scaling",
                            info.size().width,
                            info.size().height
                        );
                        shared.borrow_mut().negotiated = Some(negotiated(None));
                        buffers_pod(false)
                    }
                };
                let mut params = [Pod::from_bytes(&reply).expect("pod we just built")];
                if let Err(e) = stream.update_params(&mut params) {
                    eprintln!("update_params failed: {e}");
                }
            })
            .process(|stream, shared| {
                // Drain everything queued and keep the newest; anything
                // older is stale by definition and goes straight back.
                let mut s = shared.borrow_mut();
                loop {
                    let raw = unsafe { stream.dequeue_raw_buffer() };
                    if raw.is_null() {
                        break;
                    }
                    if !has_content(raw) {
                        s.empty += 1;
                        unsafe { stream.queue_raw_buffer(raw) };
                        continue;
                    }
                    s.received += 1;
                    if let Some(old) = s.pending.replace(raw) {
                        unsafe { stream.queue_raw_buffer(old) };
                    }
                }
            })
            .register()?;

        // GPU formats first; shared memory is offered only so a refusal is
        // reported rather than silently producing nothing.
        let pods: Vec<Vec<u8>> = offered
            .iter()
            .filter(|(_, m)| !m.is_empty())
            .map(|(f, m)| format_pod(*f, Some(m)))
            .chain(FORMATS.iter().map(|&f| format_pod(f, None)))
            .collect();
        let mut params: Vec<&Pod> = pods
            .iter()
            .map(|b| Pod::from_bytes(b).expect("pod we just built"))
            .collect();
        stream.connect(
            spa::utils::Direction::Input,
            Some(portal.node_id),
            pw::stream::StreamFlags::AUTOCONNECT,
            &mut params,
        )?;

        Ok(Self {
            _listener: listener,
            stream,
            _context: context,
            mainloop,
            shared,
            _session: session,
            _runtime: runtime,
        })
    }

    /// Runs PipeWire's pending work, waiting at most `timeout`.
    pub fn pump(&self, timeout: Duration) {
        let lp = self.mainloop.loop_();
        lp.iterate(pw::loop_::Timeout::Finite(timeout));
        // Anything else that became ready meanwhile, without waiting.
        while lp.iterate(pw::loop_::Timeout::Finite(Duration::ZERO)) > 0 {}
    }

    /// Pumps until a frame with content is waiting, so the stream's buffers
    /// are allocated and working before anything else claims GPU memory.
    pub fn wait_for_first_frame(&self, timeout: Duration) -> Result<()> {
        let deadline = std::time::Instant::now() + timeout;
        while self.shared.borrow().pending.is_none() {
            self.check()?;
            if std::time::Instant::now() >= deadline {
                bail!("no frame from the capture within {timeout:?}");
            }
            self.pump(Duration::from_millis(50));
        }
        Ok(())
    }

    /// Fails once the stream has errored.
    pub fn check(&self) -> Result<()> {
        match &self.shared.borrow().error {
            Some(e) => bail!("capture stream failed: {e}"),
            None => Ok(()),
        }
    }

    pub fn negotiated(&self) -> Option<Negotiated> {
        self.shared.borrow().negotiated
    }

    /// Buffers that arrived empty, since the last call.
    pub fn take_empty(&self) -> u64 {
        std::mem::take(&mut self.shared.borrow_mut().empty)
    }

    /// Frames that carried content, since the last call.
    pub fn take_received(&self) -> u64 {
        std::mem::take(&mut self.shared.borrow_mut().received)
    }

    /// The newest frame, if one arrived since the last call.
    pub fn take_newest(&self) -> Option<Frame> {
        let raw = self.shared.borrow_mut().pending.take()?;
        let data = unsafe { &*(*(*raw).buffer).datas };
        let chunk = unsafe { &*data.chunk };
        Some(Frame {
            raw,
            fd: data.fd as i32,
            offset: chunk.offset,
            stride: chunk.stride,
        })
    }

    /// Hands a frame's buffer back to the compositor to draw into again.
    /// Only once the GPU has finished reading it.
    pub fn release(&self, frame: Frame) {
        unsafe { self.stream.queue_raw_buffer(frame.raw) };
    }
}

/// A buffer with no memory attached (`fd -1`) or an empty chunk carries no
/// new frame — the compositor sends those when a window didn't change, or
/// when one of its buffers failed to allocate.
fn has_content(raw: *mut pw::sys::pw_buffer) -> bool {
    unsafe {
        let buffer = (*raw).buffer;
        if buffer.is_null() || (*buffer).n_datas == 0 {
            return false;
        }
        let data = &*(*buffer).datas;
        data.type_ == spa::sys::SPA_DATA_DmaBuf
            && data.fd >= 0
            && !data.chunk.is_null()
            && (*data.chunk).size > 0
    }
}
