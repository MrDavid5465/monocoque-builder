--[[
  TyPiQL puppet.

  Receives a stream of car-state frames from TyPiQL and drives THIS car to
  match them every tick — position, orientation, wheel/pedal state, lights,
  time of day. The mirror image of typiql_telemetry.lua: that app reads this
  session and sends it out; this one receives and applies. Two apps rather
  than one with a mode flag, for the same reason typiql_telemetry.lua gives:
  a passive stream and something that drives the car are different enough
  hazards to want kept apart.

  Every API used here was verified against this machine's own CSP stub at
  extension/internal/lua-sdk/ac_apps/lib.lua — see especially
  physics.setCarPosition (sets pose directly but re-aligns the car to the
  track surface and invalidates the lap every call — acceptable here since
  this car is never actually being raced) and physics.overrideSteering.
]]

local ENDPOINT = 'ws://127.0.0.1:9000/ac-puppet'

--- How often to tell TyPiQL this socket is still alive, independent of
--- whether any frames have arrived. TyPiQL's own liveness check (mirroring
--- typiql_telemetry.lua's ACK_TIMEOUT) can't tell "idle, nothing to send yet"
--- from "dead" any other way — frames only arrive when a host session is
--- actually feeding this one, but the socket can be perfectly healthy with
--- nothing to say for a while.
local HEARTBEAT_INTERVAL = 2

--- How long to wait before opening a new socket after creating one failed.
local RETRY_INTERVAL = 5

--- How old the newest frame may get before this app stops driving the car.
---
--- Mirrors `ac_telemetry`'s own STALE_AFTER on the Rust side, and for the
--- same reason: generous next to a 60Hz stream, so a stutter or a loading
--- screen on the host doesn't read as a disconnect, but short enough that a
--- host which actually went away releases the car promptly.
local STALE_AFTER = 3

local socket = nil
local status = 'connecting'
local lastError = ''
local framesReceived = 0
local heartbeatDue = 0
local retryDue = 0

--- Most recently received frame, and how long ago that was.
local latest = nil
local latestAge = 0

--- Incoming-frame handler. Stores the frame; applying it happens in
--- script.update so it runs on the same cadence as everything else the
--- game is doing, not immediately inside the socket callback.
local function onMessage(data)
  local ok, decoded = pcall(JSON.parse, data)
  if ok and decoded ~= nil then
    latest = decoded
    latestAge = 0
    framesReceived = framesReceived + 1
  end
end

--- See typiql_telemetry.lua's closeSocket for why this matters: a socket
--- abandoned with `socket = nil` alone is never actually closed, and CSP's
--- own reconnect loop (deliberately left off below) would otherwise run
--- forever on a stale reference.
local function closeSocket()
  if socket ~= nil then
    pcall(function() socket.close() end)
  end
  socket = nil
end

local function connect()
  local ok, result = pcall(function()
    return web.socket(ENDPOINT, nil, onMessage, {
      encoding = 'utf8',
      reconnect = false,
      onError = function(err)
        lastError = tostring(err)
        status = 'error'
        ac.log('typiql-puppet: socket error: ' .. lastError)
      end,
      onClose = function(reason)
        lastError = 'closed: ' .. tostring(reason)
        status = 'closed'
        socket = nil
        retryDue = RETRY_INTERVAL
        ac.log('typiql-puppet: socket closed: ' .. tostring(reason))
      end,
    })
  end)

  if ok and result ~= nil then
    socket = result
    status = 'connected'
    heartbeatDue = 0
  else
    socket = nil
    status = not ok and ('connect threw: ' .. tostring(result)) or 'connect returned nil'
    ac.log('typiql-puppet: ' .. status)
    retryDue = RETRY_INTERVAL
  end
end

--- Turns a compass heading and pitch into a forward direction vector for
--- physics.setCarPosition's `dir` argument.
---
--- ac/CSP convention here (X right, Y up, Z forward, compass 0 = north)
--- hasn't been confirmed against a real puppeted car on track yet — this is
--- exactly what the loopback test this app ships with is for. Roll can't be
--- expressed through this call at all (it only takes a look direction, not
--- an up vector), so a puppeted car's roll always comes from CSP's own
--- track-alignment rather than the source car's actual roll.
local function headingToDir(headingDeg, pitchDeg)
  local yaw = math.rad(headingDeg or 0)
  local pitch = math.rad(pitchDeg or 0)
  local cosPitch = math.cos(pitch)
  return vec3(math.sin(yaw) * cosPitch, math.sin(pitch), math.cos(yaw) * cosPitch)
end

--- How far the local and target in-game clocks may drift before correcting.
--- Small continuous corrections would fight `ac.setWeatherTimeOffset`'s own
--- instant jump semantics every frame; only closing large gaps and
--- otherwise leaving the clock to run avoids that.
local TIME_DRIFT_THRESHOLD = 1.0

--- Last known answer from `physics.allowed()`, so a change can be reported
--- once instead of every frame.
---
--- CSP refuses physics writes in contexts it considers rated. When that
--- happens this app still runs, still receives frames and still looks
--- connected, but the car simply doesn't move — which is impossible to tell
--- apart from "no frames arriving" without being told. `nil` until the
--- first check, so the initial state is always reported.
local physicsAllowed = nil

--- Reports a change in whether CSP is accepting physics writes.
---
--- Transition-triggered rather than logged each call: this runs at frame
--- rate, and a refusal logging 60 times a second would bury every other
--- line in the CSP log.
local function notePhysicsAllowed(allowed)
  if allowed == physicsAllowed then return end
  physicsAllowed = allowed
  if allowed then
    ac.log('typiql-puppet: physics writes allowed; driving the car')
  else
    ac.log('typiql-puppet: physics.allowed() is false - CSP is refusing '
      .. 'physics writes, so this car will NOT follow the host')
  end
end

local function applyFrame(frame, sim)
  local car = ac.getCar(0)
  if car == nil then return end

  -- physics.setCarNoInput was considered here, to stop this car's own
  -- (probably absent) driver inputs fighting what's applied below. Left out
  -- deliberately: the SDK docs say it switches the car to a "parked" state,
  -- and it's not documented precisely enough to know that's compatible with
  -- also forcing position/steering/gear/RPM every tick underneath it.
  -- overrideSteering/engageGear/setEngineRPM below already force the
  -- channels that matter directly, which sidesteps the question.
  local allowed = physics.allowed()
  notePhysicsAllowed(allowed)
  if allowed then
    if frame.posX ~= nil then
      local pos = vec3(frame.posX, frame.posY, frame.posZ)
      local dir = headingToDir(frame.heading, frame.pitch)
      physics.setCarPosition(0, pos, dir)
    end
    if frame.steering ~= nil then
      physics.overrideSteering(0, frame.steering)
    end
    if frame.gear ~= nil then
      physics.engageGear(0, math.floor(frame.gear))
    end
    if frame.rpm ~= nil then
      physics.setEngineRPM(0, frame.rpm)
    end
    -- physics.setWheelAngularVelocity could sync visual wheel spin to
    -- frame.speed, but converting km/h to its angular-velocity units needs
    -- this car's wheel radius, which isn't exposed anywhere findable in the
    -- CSP stub and isn't in the frame either. Left out rather than guessed;
    -- setCarPosition already carries the car forward correctly regardless,
    -- this only affects whether the wheels visually spin at the right rate.
  end

  if frame.headlightsActive ~= nil then
    ac.setHeadlights(frame.headlightsActive)
  end

  if sim ~= nil and frame.timeTotalSeconds ~= nil then
    local delta = frame.timeTotalSeconds - sim.timeTotalSeconds
    if math.abs(delta) > TIME_DRIFT_THRESHOLD then
      ac.setWeatherTimeOffset(delta, true)
    end
  end
end

function script.update(dt)
  -- Aged before every early return below — including the disconnected one —
  -- so the age is always the real age. Ageing it later would under-report
  -- while the game sits in a menu or the socket is down, which would both
  -- mislead the status window and let a stale frame be applied the moment
  -- the session came back.
  if latest ~= nil then latestAge = latestAge + dt end

  if socket == nil then
    retryDue = retryDue - dt
    if retryDue <= 0 then connect() end
    return
  end

  heartbeatDue = heartbeatDue - dt
  if heartbeatDue <= 0 then
    heartbeatDue = HEARTBEAT_INTERVAL
    local sent, sendErr = pcall(socket, 'ping')
    if not sent then
      lastError = tostring(sendErr)
      status = 'send failed'
    end
  end

  local sim = ac.getSim()
  if sim == nil or sim.isInMainMenu then return end
  if latest == nil then return end

  -- Once the stream dries up, stop driving the car rather than pinning it
  -- to the last frame received. Without this the car is held at a stale
  -- pose forever — every tick, re-invalidating the lap and overriding
  -- steering — with nothing on screen to say the host went away.
  if latestAge > STALE_AFTER then return end

  applyFrame(latest, sim)
end

function windowMain()
  ui.text('Status: ' .. status)
  ui.text(string.format('Frames received: %d', framesReceived))
  if latest ~= nil then
    -- Whether the car is actually being driven, not just whether frames are
    -- arriving. "Connected but standing still" has three quite different
    -- causes -- stale stream, CSP refusing physics, or nothing sending --
    -- and they're indistinguishable from the car itself.
    if latestAge > STALE_AFTER then
      ui.text(string.format('Last frame: %.1fs ago - STALE, not driving', latestAge))
    else
      ui.text(string.format('Last frame: %.1fs ago', latestAge))
    end
  else
    ui.text('No frame received yet')
  end
  if physicsAllowed == false then
    ui.text('physics.allowed() is FALSE - CSP is refusing physics writes,')
    ui.text('so this car will not follow the host.')
  end
  if lastError ~= '' then ui.text('Last error: ' .. lastError) end
  ui.text(ENDPOINT)
end
