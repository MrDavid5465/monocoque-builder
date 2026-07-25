use std::ffi::CStr;

#[repr(C, packed(4))]
#[derive(Debug, Clone, Copy)]
pub struct LapTime {
    pub hours: u32,
    pub minutes: u32,
    pub seconds: u32,
    pub fraction: u32,
}

#[repr(C, packed(4))]
#[derive(Debug, Clone, Copy)]
pub struct CarData {
    pub xpos: f64,
    pub ypos: f64,
    pub zpos: f64,
    pub carspline: f64,
    pub speed: f64,
    pub pos: u32,
    pub lap: u32,
    pub trackpos: u32,
    pub lastlap: LapTime,
    pub bestlap: LapTime,
    pub inpit: bool,
    pub inpitlane: bool,
    pub ingarage: bool,
    pub inpitentrance: bool,
    pub inpitexit: bool,
    pub inpitstopped: bool,
    pub driver: [u8; 128],
    pub car: [u8; 128],
}

#[repr(C, packed(4))]
#[derive(Debug, Clone, Copy)]
pub struct ProximityData {
    pub radius: f64,
    pub theta: f64,
    pub lap: u32,
}

#[repr(C, packed(4))]
#[derive(Debug, Clone, Copy)]
pub struct SimData {
    pub mtick: u64,
    pub prev_mtick: u64,

    pub simstatus: u32,
    pub velocity: u32,
    pub rpms: u32,
    pub gear: u32,
    pub pulses: u32,
    pub maxrpm: u32,
    pub idlerpm: u32,
    pub maxgears: u32,
    pub altitude: u32,
    pub lap: u32,
    pub position: u32,
    pub numlaps: u32,
    pub playerlaps: u32,
    pub numcars: u32,
    pub gearc: [u8; 3],

    pub x_velocity: f64,
    pub y_velocity: f64,
    pub z_velocity: f64,
    pub world_x_velocity: f64,
    pub world_y_velocity: f64,
    pub world_z_velocity: f64,

    pub gas: f64,
    pub brake: f64,
    pub fuel: f64,
    pub fuelcapacity: f64,
    pub clutch: f64,
    pub steer: f64,
    pub handbrake: f64,

    pub turboboost: f64,
    pub turboboostperct: f64,
    pub maxturbo: f64,

    pub abs: f64,
    pub brakebias: f64,

    pub tyre_rps: [f64; 4],
    pub tyre_diameter: [f64; 4],
    pub tyre_slip_ratio: [f64; 4],
    pub tyre_slip_angle: [f64; 4],
    pub distance: f64,

    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
    pub world_pos_x: f64,
    pub world_pos_y: f64,
    pub world_pos_z: f64,

    pub brake_temp: [f64; 4],
    pub tyre_wear: [f64; 4],
    pub tyre_temp: [f64; 4],
    pub tyre_pressure: [f64; 4],

    pub tyre_contact_0: [f64; 4],
    pub tyre_contact_1: [f64; 4],
    pub tyre_contact_2: [f64; 4],

    pub air_density: f64,
    pub air_temp: f64,
    pub track_temp: f64,

    pub suspension: [f64; 4],
    pub susp_velocity: [f64; 4],

    pub track_distance_around: f64,
    pub player_spline: f64,
    pub track_spline: f64,
    pub player_track_pos: u32,
    pub track_samples: u32,

    pub lastlap: LapTime,
    pub bestlap: LapTime,
    pub currentlap: LapTime,

    pub current_lap_seconds: u32,
    pub last_lap_seconds: u32,
    pub time: u32,
    pub session_time: LapTime,
    pub session: u8,
    pub sector_index: u8,

    pub sector1_time: f64,
    pub sector2_time: f64,
    pub last_sector_ms: u32,
    pub course_flag: u8,
    pub player_flag: u8,

    pub lap_is_valid: bool,

    pub car: [u8; 128],
    pub track: [u8; 128],
    pub driver: [u8; 128],
    pub tyre_compound: [u8; 128],

    pub cars: [CarData; 128],
    pub pd: [ProximityData; 6],

    pub simapi: u8,
    pub simexe: u64,
    pub simon: bool,
    pub simapi_version: u8,
}

const _: () = assert!(
    std::mem::size_of::<SimData>() == 46044,
    "SimData size mismatch — check padding"
);

impl SimData {
    pub fn g_lat(&self) -> f32 {
        self.x_velocity as f32
    }

    pub fn g_lon(&self) -> f32 {
        self.z_velocity as f32
    }

    pub fn g_vert(&self) -> f32 {
        self.y_velocity as f32
    }

    pub fn gear_display(&self) -> i32 {
        self.gear as i32 - 1
    }

    fn cstr(bytes: &[u8]) -> &str {
        CStr::from_bytes_until_nul(bytes)
            .map(|s| s.to_str().unwrap_or(""))
            .unwrap_or("")
    }

    pub fn car_name(&self) -> &str {
        Self::cstr(&self.car)
    }
    pub fn track_name(&self) -> &str {
        Self::cstr(&self.track)
    }
    pub fn driver_name(&self) -> &str {
        Self::cstr(&self.driver)
    }
}
