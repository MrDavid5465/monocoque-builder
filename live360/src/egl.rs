//! Just enough EGL to ask the GPU which DMA-BUF layouts it can import.
//!
//! A compositor only sends GPU buffers (instead of copying every frame into
//! shared memory) if the consumer lists the buffer modifiers it can take, and
//! the only authority on that is the driver, via
//! `eglQueryDmaBufModifiersEXT`. The display is opened on the EGL device
//! itself (`EGL_EXT_platform_device`), so no window or GBM is needed yet —
//! the renderer will reuse the same device later.

use std::ffi::{CStr, c_char, c_void};

use anyhow::{Result, bail};

type EglDisplay = *mut c_void;
type EglDevice = *mut c_void;
type EglInt = i32;
type EglBoolean = u32;

const EGL_NONE: EglInt = 0x3038;
const EGL_EXTENSIONS: EglInt = 0x3055;
const EGL_PLATFORM_DEVICE_EXT: u32 = 0x313F;
const EGL_DRM_DEVICE_FILE_EXT: EglInt = 0x3233;
const EGL_DRM_RENDER_NODE_FILE_EXT: EglInt = 0x3377;

#[link(name = "EGL")]
unsafe extern "C" {
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
    fn eglInitialize(display: EglDisplay, major: *mut EglInt, minor: *mut EglInt) -> EglBoolean;
    fn eglQueryString(display: EglDisplay, name: EglInt) -> *const c_char;
}

type QueryDevices = unsafe extern "C" fn(EglInt, *mut EglDevice, *mut EglInt) -> EglBoolean;
type QueryDeviceString = unsafe extern "C" fn(EglDevice, EglInt) -> *const c_char;
type GetPlatformDisplay = unsafe extern "C" fn(u32, *mut c_void, *const EglInt) -> EglDisplay;
type QueryModifiers = unsafe extern "C" fn(
    EglDisplay,
    EglInt,
    EglInt,
    *mut u64,
    *mut EglBoolean,
    *mut EglInt,
) -> EglBoolean;

unsafe fn proc<T>(name: &CStr) -> Result<T> {
    let ptr = unsafe { eglGetProcAddress(name.as_ptr()) };
    if ptr.is_null() {
        bail!("EGL is missing {}", name.to_string_lossy());
    }
    Ok(unsafe { std::mem::transmute_copy(&ptr) })
}

/// DRM fourcc for a PipeWire video format. PipeWire names formats by byte
/// order in memory, DRM by the little-endian word, hence the mirror image.
pub fn drm_fourcc(format: pipewire::spa::param::video::VideoFormat) -> Option<u32> {
    use pipewire::spa::param::video::VideoFormat as F;
    let code = |s: &[u8; 4]| u32::from_le_bytes(*s);
    Some(match format {
        f if f == F::BGRx => code(b"XR24"),
        f if f == F::BGRA => code(b"AR24"),
        f if f == F::RGBx => code(b"XB24"),
        f if f == F::RGBA => code(b"AB24"),
        _ => return None,
    })
}

pub struct Gpu {
    display: EglDisplay,
    query_modifiers: QueryModifiers,
    pub render_node: String,
}

impl Gpu {
    /// Opens the first EGL device backed by a real DRM node — skipping the
    /// software devices Mesa also lists.
    pub fn open() -> Result<Self> {
        unsafe {
            let query_devices: QueryDevices = proc(c"eglQueryDevicesEXT")?;
            let query_string: QueryDeviceString = proc(c"eglQueryDeviceStringEXT")?;
            let get_display: GetPlatformDisplay = proc(c"eglGetPlatformDisplayEXT")?;
            let query_modifiers: QueryModifiers = proc(c"eglQueryDmaBufModifiersEXT")?;

            let mut devices = [std::ptr::null_mut(); 16];
            let mut count = 0;
            if query_devices(devices.len() as EglInt, devices.as_mut_ptr(), &mut count) == 0 {
                bail!("eglQueryDevicesEXT failed");
            }
            for &device in &devices[..count as usize] {
                let node = [EGL_DRM_RENDER_NODE_FILE_EXT, EGL_DRM_DEVICE_FILE_EXT]
                    .into_iter()
                    .map(|name| query_string(device, name))
                    .find(|p| !p.is_null());
                let Some(node) = node else { continue };
                let render_node = CStr::from_ptr(node).to_string_lossy().into_owned();

                let attribs = [EGL_NONE];
                let display = get_display(EGL_PLATFORM_DEVICE_EXT, device, attribs.as_ptr());
                if display.is_null() {
                    continue;
                }
                let (mut major, mut minor) = (0, 0);
                if eglInitialize(display, &mut major, &mut minor) == 0 {
                    continue;
                }
                let extensions = eglQueryString(display, EGL_EXTENSIONS);
                if extensions.is_null()
                    || !CStr::from_ptr(extensions)
                        .to_string_lossy()
                        .contains("EGL_EXT_image_dma_buf_import_modifiers")
                {
                    continue;
                }
                return Ok(Self {
                    display,
                    query_modifiers,
                    render_node,
                });
            }
            bail!("no EGL device can import DMA-BUFs with modifiers")
        }
    }

    /// Modifiers this GPU can sample `fourcc` from as an ordinary texture.
    /// External-only layouts are left out: the renderer samples a regular
    /// 2D texture, and would otherwise be handed one it can't use.
    pub fn modifiers(&self, fourcc: u32) -> Vec<u64> {
        unsafe {
            let mut count = 0;
            let f = self.query_modifiers;
            if f(
                self.display,
                fourcc as EglInt,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut count,
            ) == 0
            {
                return Vec::new();
            }
            let mut modifiers = vec![0u64; count as usize];
            let mut external = vec![0u32; count as usize];
            f(
                self.display,
                fourcc as EglInt,
                count,
                modifiers.as_mut_ptr(),
                external.as_mut_ptr(),
                &mut count,
            );
            modifiers
                .into_iter()
                .zip(external)
                .take(count as usize)
                .filter(|&(_, external_only)| external_only == 0)
                .map(|(m, _)| m)
                .collect()
        }
    }
}
