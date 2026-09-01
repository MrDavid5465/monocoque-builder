--[[
  TyPiQL extended telemetry.

  Streams the things Assetto Corsa knows but the cross-sim shared-memory
  bridge doesn't carry: the in-game clock, sun and ambient light, the cockpit
  camera offset the game actually applied, whether the car is under cover,
  and world position.

  Passive. It reads state and sends it; it never changes anything about the
  session. That is the whole difference between this app and the capture one,
  which drives the game and quits it — hence two separate apps rather than
  one with a mode flag.

  Every field below was checked against this install's own CSP stubs at
  extension/internal/lua-sdk/ac_apps/lib.lua.
]]

local ENDPOINT = 'ws://127.0.0.1:9000/ac-telemetry'

--- Send rate. 30Hz rather than every frame: the consumers are dashboards
--- refreshing at screen rate, and halving the traffic costs them nothing
--- visible while leaving headroom on the socket.
local SEND_INTERVAL = 1 / 30

--- How long to wait before building a new socket if creating one outright
--- failed. Distinct from CSP's own `reconnect` handling below, which covers
--- a socket that existed and then dropped.
local RETRY_INTERVAL = 5

local socket = nil
local status = 'connecting'
local sendDue = 0
local retryDue = 0

--- Opens the socket.
---
--- Three things about `web.socket` that aren't obvious and each broke this
--- once: it **returns** the socket rather than handing it to a callback; the
--- `callback` argument is for *incoming* data, not connection status (hence
--- `nil` — nothing is expected back); and the returned socket is *callable*,
--- so sending is `socket(data)`, not `socket:send(data)`.
---
--- Connection problems surface through `onError`/`onClose` instead, and
--- `reconnect` makes CSP restore a dropped connection on its own — TyPiQL
--- may not be running when the game starts, and that shouldn't need handling
--- here.
local function connect()
  local ok, result = pcall(function()
    return web.socket(ENDPOINT, nil, nil, {
      encoding = 'utf8',
      reconnect = true,
      onError = function(err)
        status = 'error: ' .. tostring(err)
      end,
      onClose = function()
        status = 'closed'
        socket = nil
      end,
    })
  end)

  if ok and result ~= nil then
    socket = result
    status = 'connected'
  else
    socket = nil
    -- The error is reported, not swallowed. Discarding it here cost a
    -- round of guessing already: "no connection" says nothing about whether
    -- the call threw, was refused, or simply returned nothing.
    if not ok then
      status = 'connect threw: ' .. tostring(result)
    else
      status = 'connect returned nil'
    end
    ac.log('typiql-telemetry: ' .. status)
    retryDue = RETRY_INTERVAL
  end
end

--- The head offset the game applied this frame, in car-local metres.
---
--- Returned as a delta from the driver's rest eye position rather than an
--- absolute, because that difference *is* NeckFX's output — including the
--- steering follow and look-ahead terms a dashboard could never reproduce
--- from g-forces alone.
---
--- Worth being explicit about why this isn't computed from acceleration:
--- CSP's own implementation is a washout filter, so during a sustained
--- corner the real head drifts back to centre and then overshoots the other
--- way on release. A proportional mapping of g-force is out of phase with
--- that for a good part of every corner.
local function neckOffset(car)
  local applied = ac.getCameraPositionRelativeToCar()
  if applied == nil or car == nil then return 0, 0, 0 end
  local rest = car.driverEyesPosition
  if rest == nil then return applied.x, applied.y, applied.z end
  return applied.x - rest.x, applied.y - rest.y, applied.z - rest.z
end

local function buildFrame(sim, car)
  local neckX, neckY, neckZ = neckOffset(car)
  local position = car ~= nil and car.position or nil

  return {
    time_total_seconds = sim.timeTotalSeconds,
    day_of_year = sim.dayOfYear,
    timestamp = sim.timestamp,
    time_multiplier = sim.timeMultiplier,

    sun_angle_deg = ac.getSunAngle(),
    sun_pitch_deg = ac.getSunPitchAngle(),
    light_suggestion = sim.lightSuggestion,
    ambient_lighting_multiplier = sim.ambientLightingMultiplier,
    ambient_occlusion = car ~= nil and car.ambientOcclusion or 1,

    neck_offset_x = neckX,
    neck_offset_y = neckY,
    neck_offset_z = neckZ,

    sky_occlusion = sim.weatherSkyOcclusion,
    rain_intensity = sim.rainIntensity,
    wind_speed_kmh = sim.windSpeedKmh,
    wind_direction_deg = sim.windDirectionDeg,

    pos_x = position ~= nil and position.x or 0,
    pos_y = position ~= nil and position.y or 0,
    pos_z = position ~= nil and position.z or 0,
    compass = car ~= nil and car.compass or 0,
    spline_position = car ~= nil and car.splinePosition or 0,

    headlights_active = car ~= nil and car.headlightsActive or false,
    high_beams = car ~= nil and car.highBeams or false,
    brake_lights_active = car ~= nil and car.brakeLightsActive or false,

    -- Much of the car-level data above is absent for remote cars online and
    -- in replays, so consumers are told rather than left to infer it from
    -- implausible values.
    physics_available = car ~= nil and car.physicsAvailable or false,
  }
end

function script.update(dt)
  if socket == nil then
    retryDue = retryDue - dt
    if retryDue <= 0 then connect() end
    return
  end

  sendDue = sendDue - dt
  if sendDue > 0 then return end
  sendDue = SEND_INTERVAL

  local sim = ac.getSim()
  if sim == nil or sim.isInMainMenu then return end

  -- Both are cached FFI references that CSP documents as very cheap; the
  -- expensive things (string accessors, scene queries) are deliberately
  -- absent from the frame.
  local car = ac.getCar(0)
  local built, encoded = pcall(JSON.stringify, buildFrame(sim, car))
  if not built then
    status = 'encode threw: ' .. tostring(encoded)
    return
  end

  -- Calling the socket is how you send on it; see connect() above.
  local sent, sendErr = pcall(socket, encoded)
  if sent then
    status = 'streaming'
  else
    status = 'send threw: ' .. tostring(sendErr)
  end
end

function windowMain()
  -- Reports the real state rather than just "connected or not": a socket
  -- that opened and then failed to send looks identical to one that never
  -- opened, and telling those apart is most of the debugging.
  ui.text('Status: ' .. status)
  ui.text(ENDPOINT)
  local sim = ac.getSim()
  if sim ~= nil then
    ui.text(string.format('%02d:%02d in game', sim.timeHours, sim.timeMinutes))
    ui.text(string.format('lightSuggestion %.2f', sim.lightSuggestion))
  end
end
