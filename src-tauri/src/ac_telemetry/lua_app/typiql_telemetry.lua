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

--- Send rate. Full 60Hz, matching screen rate: the NeckFX sway consumers read
--- this from inside a requestAnimationFrame loop, so anything slower steps
--- visibly rather than moving. An earlier 30Hz halved the traffic on the
--- assumption that dashboards only needed gauge values, which stopped being
--- true once the cockpit camera offset started driving motion.
local SEND_INTERVAL = 1 / 60

--- How long to wait before building a new socket if creating one outright
--- failed. Distinct from CSP's own `reconnect` handling below, which covers
--- a socket that existed and then dropped.
local RETRY_INTERVAL = 5

--- How long to accept silence from TyPiQL before assuming the socket is dead.
--- Several times the server's own ack interval, so ordinary jitter or a
--- frame-rate stall doesn't trigger a needless reconnect.
local ACK_TIMEOUT = 6

local socket = nil
local status = 'connecting'
--- Sticky: survives the status line being overwritten each send, so the
--- reason a connection failed is still readable afterwards.
local lastError = ''
--- Counts frames actually handed to the socket. A rising count with nothing
--- arriving server-side means the send is silently going nowhere, which is
--- exactly the case "streaming" hid.
local framesSent = 0
--- Seconds since TyPiQL last acknowledged a frame.
---
--- The socket cannot be trusted to report its own death: after a backend
--- restart this app sent over ten thousand frames into a closed connection
--- without CSP raising `onError` or `onClose`, so its `reconnect` never fired
--- and the status line cheerfully read "streaming". Silence from the far end
--- is the real signal.
local sinceAck = 0
--- Whether this socket has *ever* been acked. Until it has, silence means
--- "still connecting" rather than "connection died".
local acked = false
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
--- Incoming-data handler. Nothing is expected back — this is a one-way
--- stream — but it can't be `nil`: despite the SDK annotating the parameter
--- as `nil|fun(data: binary)`, CSP rejects a nil one at runtime with
--- "Callback should be a function", which is what stopped the first build
--- connecting at all.
--- Acks from TyPiQL. The payload is irrelevant; what matters is that one
--- arrived, which is the only proof the far end is still there.
local function onMessage(_data)
  sinceAck = 0
  acked = true
end

--- Hands the socket back to CSP before dropping the reference.
---
--- Not optional, and not merely tidy. Per the SDK: with `reconnect`, "onClose
--- is only called once connection is closed by calling web.Socket.close()".
--- So a socket abandoned with `socket = nil` alone is never closed, CSP never
--- learns it was abandoned, and its retry loop runs for the rest of the
--- session with nothing able to stop it. Dropping one every ACK_TIMEOUT while
--- TyPiQL was restarting accumulated dozens of immortal reconnect loops on
--- the render thread and made the game unplayable — the CPU spike traced back
--- to exactly this.
local function closeSocket()
  if socket ~= nil then
    -- pcall: a socket that already died can throw here, and failing to close
    -- it must not take out the update loop.
    pcall(function() socket.close() end)
  end
  socket = nil
end

local function connect()
  local ok, result = pcall(function()
    return web.socket(ENDPOINT, nil, onMessage, {
      encoding = 'utf8',
      -- CSP's own reconnection is deliberately OFF: this app already decides
      -- when a socket is dead, using acks, because CSP's view of that proved
      -- unreliable (see `sinceAck`). Running both means two independent
      -- authorities on the same connection — ours tears down and rebuilds
      -- while CSP's silently resurrects what we discarded.
      reconnect = false,
      -- Both also go to the CSP log, and `lastError` is deliberately never
      -- cleared by a successful send.
      --
      -- The first version only wrote these to the status line, which the
      -- send path overwrites with "streaming" every frame — so the app
      -- cheerfully reported streaming while nothing was connecting, and the
      -- actual reason was destroyed 30 times a second.
      onError = function(err)
        lastError = tostring(err)
        status = 'error'
        ac.log('typiql-telemetry: socket error: ' .. lastError)
      end,
      onClose = function(reason)
        lastError = 'closed: ' .. tostring(reason)
        status = 'closed'
        socket = nil
        -- Without this, `retryDue` keeps whatever value it had (0 at startup,
        -- or already negative), so the update loop below calls connect() on
        -- EVERY frame until one succeeds — a second way this path could burn
        -- the CPU while TyPiQL was down.
        retryDue = RETRY_INTERVAL
        ac.log('typiql-telemetry: socket closed: ' .. tostring(reason))
      end,
    })
  end)

  if ok and result ~= nil then
    socket = result
    status = 'connected'
    sinceAck = 0
    acked = false
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
--- Head ROTATION relative to the car, in degrees.
---
--- This is the channel NeckFX actually drives in most configurations. Its
--- three effects -- TRACK_FOLLOWING, SLIDING_LOOK and STEERING (see
--- cfg/extension/neck.ini) -- all change where the head LOOKS, not where it
--- sits. Reading only the eye POSITION, as neckOffset below does, therefore
--- reports almost nothing on a rig whose neck.ini is a typical
--- look-into-the-corner setup, which is exactly what was measured: the
--- offsets stayed near zero however hard the car was cornering.
---
--- Both channels are sent. Position still matters for vertical movement over
--- kerbs, and for anyone who turns the following effects up.
---
--- The camera's forward vector is world-space, so it is projected onto the
--- car's own axes (look/up/side are normalised, so each dot product is a
--- direct component) to get an angle relative to the car rather than to the
--- world -- otherwise simply driving round a bend would read as a huge neck
--- rotation.
local function neckRotation(car)
  if car == nil then return 0, 0, 0 end
  local fwd = ac.getCameraForward()
  local up = ac.getCameraUp()
  if fwd == nil or up == nil or car.look == nil or car.up == nil or car.side == nil then
    return 0, 0, 0
  end
  local yaw = math.deg(math.atan2(fwd:dot(car.side), fwd:dot(car.look)))
  -- Clamped before asin: floating point can nudge a normalised dot product a
  -- hair outside [-1, 1], and asin returns NaN there, which would poison every
  -- consumer downstream.
  local vertical = math.max(-1, math.min(1, fwd:dot(car.up)))
  local pitch = math.deg(math.asin(vertical))
  local roll = math.deg(math.atan2(up:dot(car.side), up:dot(car.up)))
  return yaw, pitch, roll
end

--- Head POSITION relative to the driver's rest eye point, in car-local metres.
local function neckOffset(car)
  local applied = ac.getCameraPositionRelativeToCar()
  if applied == nil or car == nil then return 0, 0, 0 end
  local rest = car.driverEyesPosition
  if rest == nil then return applied.x, applied.y, applied.z end
  return applied.x - rest.x, applied.y - rest.y, applied.z - rest.z
end

local function buildFrame(sim, car)
  local neckX, neckY, neckZ = neckOffset(car)
  local neckYaw, neckPitch, neckRoll = neckRotation(car)
  local position = car ~= nil and car.position or nil

  return {
    time_total_seconds = sim.timeTotalSeconds,
    day_of_year = sim.dayOfYear,
    timestamp = sim.timestamp,
    time_multiplier = sim.timeMultiplier,

    sun_angle_deg = ac.getSunAngle(),
    sun_pitch_deg = ac.getSunPitchAngle(),
    -- True when AC swings the sun as though it were 20th March regardless of
    -- the real date (seasons off, or no session date). Load-bearing: it
    -- decides whether real-world astronomy for the actual date describes the
    -- sky at all. Measured on this rig with it set, computing for the real
    -- date put sunrise 43 minutes from where the game actually had it, while
    -- computing for the equinox landed within a couple of degrees.
    --
    -- There is deliberately no sun-elevation field here. `sim.lightDirection`
    -- is documented "sun OR moon", and before dawn it is the moon: it read
    -- 56 degrees of elevation at an hour when the sun was 6 degrees BELOW the
    -- horizon, which is above the sun's maximum possible elevation at this
    -- latitude. Elevation is computed from this flag plus the clock instead.
    equinox_sun_trajectory = sim.equinoxSunTrajectory,
    light_suggestion = sim.lightSuggestion,
    ambient_lighting_multiplier = sim.ambientLightingMultiplier,
    ambient_occlusion = car ~= nil and car.ambientOcclusion or 1,

    neck_offset_x = neckX,
    neck_offset_y = neckY,
    neck_offset_z = neckZ,
    neck_yaw_deg = neckYaw,
    neck_pitch_deg = neckPitch,
    neck_roll_deg = neckRoll,

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

  -- Rebuilt from scratch when the acks stop: closed, then replaced. Asking
  -- the old socket to reconnect is what silently failed before — and merely
  -- dropping the reference without closing is what leaked reconnect loops
  -- (see closeSocket).
  sinceAck = sinceAck + dt
  -- Deliberately not conditional on having been acked before. Gating this on
  -- a previous ack meant a socket that never got one was never torn down —
  -- precisely what happens when the app connects while TyPiQL is restarting.
  -- A fresh socket gets the same window to prove itself, which is generous:
  -- frames go out at 60Hz and the server acks within a second.
  if sinceAck > ACK_TIMEOUT then
    lastError = string.format('no ack for %.0fs, reconnecting', sinceAck)
    ac.log('typiql-telemetry: ' .. lastError)
    closeSocket()
    status = 'reconnecting'
    -- Was 0, i.e. rebuild on the very next frame. Backing off matters when
    -- TyPiQL is down for a while (a rebuild, say): with no wait, this cycle
    -- spun up a fresh socket every ACK_TIMEOUT indefinitely.
    retryDue = RETRY_INTERVAL
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
    framesSent = framesSent + 1
    -- Only claims to be streaming while nothing has gone wrong: a send that
    -- doesn't throw is not evidence the socket ever connected.
    if lastError == '' then status = 'streaming' end
  else
    lastError = tostring(sendErr)
    status = 'send failed'
  end
end

function windowMain()
  -- Reports the real state rather than just "connected or not": a socket
  -- that opened and then failed to send looks identical to one that never
  -- opened, and telling those apart is most of the debugging.
  ui.text('Status: ' .. status)
  ui.text(string.format('Frames sent: %d', framesSent))
  ui.text(acked and string.format('Last ack: %.1fs ago', sinceAck) or 'Never acked')
  if lastError ~= '' then ui.text('Last error: ' .. lastError) end
  ui.text(ENDPOINT)
  local sim = ac.getSim()
  if sim ~= nil then
    ui.text(string.format('%02d:%02d in game', sim.timeHours, sim.timeMinutes))
    ui.text(string.format('lightSuggestion %.2f', sim.lightSuggestion))
  end
end
