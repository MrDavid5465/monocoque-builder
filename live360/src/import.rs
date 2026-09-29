//! DMA-BUF → GL texture, with no copy.
//!
//! Each PipeWire buffer is a fixed piece of GPU memory the compositor draws
//! into over and over, so the import is done once per buffer and the texture
//! reused: with two buffers that's two imports for the life of the stream.

use std::collections::HashMap;
use std::ffi::c_void;

use anyhow::{Result, bail};
use glow::HasContext;

use crate::capture::Negotiated;

type EglDisplay = *const c_void;
type EglImage = *mut c_void;

const EGL_NONE: i32 = 0x3038;
const EGL_WIDTH: i32 = 0x3057;
const EGL_HEIGHT: i32 = 0x3056;
const EGL_LINUX_DMA_BUF_EXT: u32 = 0x3270;
const EGL_LINUX_DRM_FOURCC_EXT: i32 = 0x3271;
const EGL_DMA_BUF_PLANE0_FD_EXT: i32 = 0x3272;
const EGL_DMA_BUF_PLANE0_OFFSET_EXT: i32 = 0x3273;
const EGL_DMA_BUF_PLANE0_PITCH_EXT: i32 = 0x3274;
const EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT: i32 = 0x3443;
const EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT: i32 = 0x3444;

type CreateImage =
    unsafe extern "C" fn(EglDisplay, *mut c_void, u32, *mut c_void, *const i32) -> EglImage;
type DestroyImage = unsafe extern "C" fn(EglDisplay, EglImage) -> u32;
type ImageTargetTexture = unsafe extern "C" fn(u32, EglImage);

pub struct Importer {
    display: EglDisplay,
    create_image: CreateImage,
    destroy_image: DestroyImage,
    target_texture: ImageTargetTexture,
    /// Keyed by the buffer's fd, which is stable for the life of the stream.
    textures: HashMap<i32, (glow::Texture, EglImage)>,
}

impl Importer {
    /// `lookup` resolves EGL/GL entry points through the context's display.
    pub fn new(display: EglDisplay, lookup: impl Fn(&str) -> *const c_void) -> Result<Self> {
        let get = |name: &str| {
            let ptr = lookup(name);
            if ptr.is_null() {
                bail!("{name} is unavailable");
            }
            Ok(ptr)
        };
        unsafe {
            Ok(Self {
                display,
                create_image: std::mem::transmute::<*const c_void, CreateImage>(get(
                    "eglCreateImageKHR",
                )?),
                destroy_image: std::mem::transmute::<*const c_void, DestroyImage>(get(
                    "eglDestroyImageKHR",
                )?),
                target_texture: std::mem::transmute::<*const c_void, ImageTargetTexture>(get(
                    "glEGLImageTargetTexture2DOES",
                )?),
                textures: HashMap::new(),
            })
        }
    }

    /// The texture for the buffer at `fd`, importing it on first sight.
    pub fn texture(
        &mut self,
        gl: &glow::Context,
        format: &Negotiated,
        fd: i32,
        offset: u32,
        stride: i32,
    ) -> Result<glow::Texture> {
        if let Some((texture, _)) = self.textures.get(&fd) {
            return Ok(*texture);
        }
        let Some(modifier) = format.modifier else {
            bail!("stream isn't DMA-BUF");
        };
        let attribs = [
            EGL_WIDTH,
            format.width as i32,
            EGL_HEIGHT,
            format.height as i32,
            EGL_LINUX_DRM_FOURCC_EXT,
            format.fourcc as i32,
            EGL_DMA_BUF_PLANE0_FD_EXT,
            fd,
            EGL_DMA_BUF_PLANE0_OFFSET_EXT,
            offset as i32,
            EGL_DMA_BUF_PLANE0_PITCH_EXT,
            stride,
            EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,
            (modifier & 0xffff_ffff) as i32,
            EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,
            (modifier >> 32) as i32,
            EGL_NONE,
        ];
        unsafe {
            let image = (self.create_image)(
                self.display,
                std::ptr::null_mut(),
                EGL_LINUX_DMA_BUF_EXT,
                std::ptr::null_mut(),
                attribs.as_ptr(),
            );
            if image.is_null() {
                bail!("eglCreateImageKHR refused the buffer (fd {fd}, modifier {modifier:#x})");
            }
            let texture = gl.create_texture().map_err(anyhow::Error::msg)?;
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
            (self.target_texture)(glow::TEXTURE_2D, image);
            gl.tex_parameter_i32(
                glow::TEXTURE_2D,
                glow::TEXTURE_MIN_FILTER,
                glow::LINEAR as i32,
            );
            gl.tex_parameter_i32(
                glow::TEXTURE_2D,
                glow::TEXTURE_MAG_FILTER,
                glow::LINEAR as i32,
            );
            // Longitude wraps: sampling across the seam behind the car has
            // to blend the right edge into the left, not smear one edge.
            gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_S, glow::REPEAT as i32);
            gl.tex_parameter_i32(
                glow::TEXTURE_2D,
                glow::TEXTURE_WRAP_T,
                glow::CLAMP_TO_EDGE as i32,
            );
            eprintln!(
                "imported buffer fd {fd} ({}x{})",
                format.width, format.height
            );
            self.textures.insert(fd, (texture, image));
            Ok(texture)
        }
    }

    /// Drops every import, e.g. after the stream renegotiated its buffers.
    pub fn clear(&mut self, gl: &glow::Context) {
        for (_, (texture, image)) in self.textures.drain() {
            unsafe {
                gl.delete_texture(texture);
                (self.destroy_image)(self.display, image);
            }
        }
    }
}
