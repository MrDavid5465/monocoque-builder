pub mod recording;
pub mod simdata;
pub mod types;
use memmap2::MmapOptions;
use simdata::SimData;
use std::fs::File;
use types::{CourseFlag, SimStatus, TelemetryFrame, TyreData};

const SIMAPI_PATH: &str = "/dev/shm/SIMAPI.DAT";

pub fn read_simdata() -> Option<SimData> {
    let file = File::open(SIMAPI_PATH)
        .map_err(|e| {
            eprintln!("Failed to open SIMAPI.DAT: {e}");
            e
        })
        .ok()?;

    let mmap = unsafe {
        MmapOptions::new()
            .map(&file)
            .map_err(|e| {
                eprintln!("Failed to mmap: {e}");
                e
            })
            .ok()?
    };

    let expected = std::mem::size_of::<SimData>();
    if mmap.len() < expected {
        eprintln!("SIMAPI.DAT too small: {} < {expected}", mmap.len());
        return None;
    }

    let data = unsafe { std::ptr::read_unaligned(mmap.as_ptr() as *const SimData) };

    Some(data)
}

pub fn build_frame(d: SimData) -> TelemetryFrame {
    TelemetryFrame {
        sim_status: match d.simstatus {
            1 => SimStatus::Menu,
            2 => SimStatus::Active,
            _ => SimStatus::Off,
        },
        simon: d.simon,
        car: d.car_name().to_string(),
        track: d.track_name().to_string(),
        driver: d.driver_name().to_string(),
        tyre_compound: std::ffi::CStr::from_bytes_until_nul(&d.tyre_compound)
            .map(|s| s.to_str().unwrap_or("").to_string())
            .unwrap_or_default(),

        g_lat: d.g_lat(),
        g_lon: d.g_lon(),
        g_vert: d.g_vert(),
        heading: d.heading,
        pitch: d.pitch,
        roll: d.roll,

        speed: d.velocity as f64,
        rpm: d.rpms,
        max_rpm: d.maxrpm,
        idle_rpm: d.idlerpm,
        gear: d.gear_display(),
        max_gears: d.maxgears,
        throttle: d.gas,
        brake: d.brake,
        clutch: d.clutch,
        steering: d.steer,
        handbrake: d.handbrake,
        abs: d.abs,
        brake_bias: d.brakebias,

        fuel: d.fuel,
        fuel_capacity: d.fuelcapacity,
        turbo_boost: d.turboboost,
        turbo_pct: d.turboboostperct,

        tyres: (0..4)
            .map(|i| TyreData {
                temp: d.tyre_temp[i],
                pressure: d.tyre_pressure[i],
                slip_ratio: d.tyre_slip_ratio[i],
                slip_angle: d.tyre_slip_angle[i],
                wear: d.tyre_wear[i],
                brake_temp: d.brake_temp[i],
                rps: d.tyre_rps[i],
                diameter: d.tyre_diameter[i],
            })
            .collect(),

        air_temp: d.air_temp,
        track_temp: d.track_temp,
        air_density: d.air_density,

        lap: d.lap,
        position: d.position,
        num_laps: d.numlaps,
        num_cars: d.numcars,
        course_flag: match d.course_flag {
            1 => CourseFlag::Yellow,
            2 => CourseFlag::Red,
            3 => CourseFlag::Chequered,
            4 => CourseFlag::Blue,
            5 => CourseFlag::White,
            6 => CourseFlag::Black,
            7 => CourseFlag::BlackWhite,
            8 => CourseFlag::BlackOrange,
            9 => CourseFlag::Orange,
            _ => CourseFlag::Green,
        },
        lap_is_valid: d.lap_is_valid,
        in_pit: d.cars[0].inpit,
        current_lap_seconds: d.current_lap_seconds,
        last_lap_seconds: d.last_lap_seconds,
        sector1_time: d.sector1_time,
        sector2_time: d.sector2_time,
    }
}
