use async_graphql::{Enum, SimpleObject};
use serde::{Deserialize, Serialize};

#[derive(Enum, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, Debug, Default)]
pub enum SimStatus {
    #[default]
    Off,
    Menu,
    Active,
}

#[derive(Enum, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, Debug, Default)]
pub enum CourseFlag {
    #[default]
    Green,
    Yellow,
    Red,
    Chequered,
    Blue,
    White,
    Black,
    BlackWhite,
    BlackOrange,
    Orange,
}

#[derive(SimpleObject, Clone, Serialize, Deserialize)]
pub struct TyreData {
    pub temp: f64,
    pub pressure: f64,
    pub slip_ratio: f64,
    pub slip_angle: f64,
    pub wear: f64,
    pub brake_temp: f64,
    pub rps: f64,
    pub diameter: f64,
}

#[derive(SimpleObject, Clone, Serialize, Deserialize)]
pub struct TelemetryFrame {
    // Status
    pub sim_status: SimStatus,
    pub simon: bool,
    pub car: String,
    pub track: String,
    pub driver: String,
    pub tyre_compound: String,

    // Motion — for gauge sway and tilt
    pub g_lat: f32,  // lateral G
    pub g_lon: f32,  // longitudinal G
    pub g_vert: f32, // vertical G
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,

    // Drivetrain
    pub speed: f64,
    pub rpm: u32,
    pub max_rpm: u32,
    pub idle_rpm: u32,
    pub gear: i32, // -1=R, 0=N, 1–8
    pub max_gears: u32,
    pub throttle: f64,
    pub brake: f64,
    pub clutch: f64,
    pub steering: f64,
    pub handbrake: f64,
    pub abs: f64,
    pub brake_bias: f64,

    // Fuel & engine
    pub fuel: f64,
    pub fuel_capacity: f64,
    pub turbo_boost: f64,
    pub turbo_pct: f64,

    // Tyres: [FL, FR, RL, RR]
    pub tyres: Vec<TyreData>,

    // Environment
    pub air_temp: f64,
    pub track_temp: f64,
    pub air_density: f64,

    // Session
    pub lap: u32,
    pub position: u32,
    pub num_laps: u32,
    pub num_cars: u32,
    pub course_flag: CourseFlag,
    pub lap_is_valid: bool,
    pub in_pit: bool,
    pub current_lap_seconds: u32,
    pub last_lap_seconds: u32,
    pub sector1_time: f64,
    pub sector2_time: f64,
}
