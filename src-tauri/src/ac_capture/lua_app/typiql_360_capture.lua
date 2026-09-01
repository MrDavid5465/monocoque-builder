--[[
  TyPiQL 360° reference photo capture.

  Drives one unattended capture of a car's cockpit: enter the car, hide the
  UI, shoot the day frame, jump the clock forward, switch the headlights on
  so the dashboard is lit, shoot the night frame, then quit the game.

  Both frames come out of a SINGLE session on purpose. TyPiQL crossfades
  them against each other (Photo360CrossfadeViewer), so the two images have
  to be pixel-aligned — relaunching the game between them would risk a
  slightly different car/camera placement and a visible swim during the
  fade.

  IMPORTANT — this app stays installed in AC permanently, including for
  ordinary play sessions. It must therefore do nothing at all unless TyPiQL
  has explicitly queued a job: otherwise it would hide the user's HUD and
  shut down their game mid-drive. Two things enforce that:
    1. It only ever acts when `job.ini` exists.
    2. It consumes (deletes) `job.ini` before touching anything, so a crash
       or power loss mid-capture still leaves the next launch inert.

  Every API used here was verified against this machine's own CSP stubs at
  assettocorsa/extension/internal/lua-sdk/ac_apps/lib.lua — the public
  GitHub SDK repos don't carry the full API surface.
]]

local JOB_DIR = ac.dirname()
local JOB_FILE = JOB_DIR .. '/job.ini'
local OUT_DIR = JOB_DIR .. '/out'
local RESULT_FILE = OUT_DIR .. '/result.ini'

-- Screenshots are written into this app's own folder rather than a path
-- handed over by TyPiQL. TyPiQL runs on Linux while this script runs inside
-- the Proton prefix, so any absolute path would need translating between
-- the two worlds; a location both sides already know how to find avoids
-- that entirely.
local DAY_FILE = OUT_DIR .. '/day.png'
local NIGHT_FILE = OUT_DIR .. '/night.png'

--- How long to keep asking to leave the pits before assuming the car is
--- already on track and carrying on anyway.
local START_ATTEMPT_SECONDS = 8

--- Minimal `KEY=VALUE` reader. Deliberately not JSON: this only ever parses
--- a file TyPiQL wrote moments earlier, and avoiding a JSON dependency
--- keeps the script working regardless of which CSP build is installed.
local function parseIni(text)
  local values = {}
  for line in text:gmatch('[^\r\n]+') do
    if not line:match('^%s*[;#%[]') then
      local key, value = line:match('^%s*([%w_]+)%s*=%s*(.-)%s*$')
      if key then values[key:upper()] = value end
    end
  end
  return values
end

local function num(values, key, fallback)
  return tonumber(values[key]) or fallback
end

--- Loads the queued job, if any, and immediately consumes it. Returns nil
--- when there's nothing to do, which is the normal case for a regular play
--- session.
local function claimJob()
  if not io.exists(JOB_FILE) then return nil end

  local raw = io.load(JOB_FILE, '')
  -- Consumed before any work starts, never after: a capture that crashes
  -- part-way must not re-arm itself on the user's next ordinary launch.
  io.deleteFile(JOB_FILE)
  if raw == '' then return nil end

  local values = parseIni(raw)
  return {
    id = values.ID or '',
    carId = values.CAR_ID or '',
    -- 12h by default, matching the "+12h" button in CSP's debug app that
    -- this replaces. Seconds, because that's the unit
    -- ac.setWeatherTimeOffset takes.
    nightOffset = num(values, 'NIGHT_OFFSET_SECONDS', 12 * 60 * 60),
    -- Where to put the car before shooting. Defaults to the hotlap start:
    -- pit lane is usually floodlit, which washes out the night frame and
    -- defeats the point of turning the headlights on. Somewhere out on
    -- track is dark enough for the lit dashboard to actually read.
    --
    -- Also makes placement identical from car to car, instead of depending
    -- on whichever pit box the session happened to allocate.
    spawnSet = values.SPAWN_SET or ac.SpawnSet.HotlapStart,
    -- Whether the car needs moving at all. False when the session already
    -- spawned it where the photo is taken, which is the normal case.
    teleport = (values.TELEPORT or '0') ~= '0',
    -- Time to let the car land and stop moving after being teleported.
    placeSettle = num(values, 'PLACE_SETTLE_SECONDS', 3.0),
    -- Time for the scene to stabilise before a shot. The night settle is
    -- much longer than the day one because auto-exposure has to adapt to
    -- the light level collapsing; shooting too early yields a frame that is
    -- still mid-adaptation and far too bright.
    daySettle = num(values, 'DAY_SETTLE_SECONDS', 1.5),
    nightSettle = num(values, 'NIGHT_SETTLE_SECONDS', 4.0),
    -- Whole-run guard. If any step wedges (session never starts, a
    -- screenshot callback never fires), give up and report rather than
    -- leaving AC running forever with the user's config still swapped out.
    timeout = num(values, 'TIMEOUT_SECONDS', 240),
    shutdown = (values.SHUTDOWN_WHEN_DONE or '1') ~= '0',
  }
end

local job = claimJob()
local state = job and 'wait_session' or 'idle'
local elapsed = 0
local stateTime = 0
local status = job and 'Waiting for session' or 'Idle - no job queued'
local shotError = nil

--- What the car's lights actually did, as opposed to what was asked for.
--- Reported back so a mismatch is visible instead of silent. Declared up
--- here because writeResult below closes over it, and a local declared
--- later would be a different (global, nil) name inside that function.
local lightsReport = ''

--- How the car actually got into a drivable state.
---
--- Recorded because it isn't yet established that the script gets there on
--- its own: every successful run so far had a human press "enter car", so
--- `ac.tryToStart` might be doing nothing and simply never be the reason the
--- session starts. These say how long the wait actually took and whether the
--- API call ever reported success.
local startReport = ''
local waitSeconds = 0
local startedByApi = false
--- Time spent out of the menus, so the give-up timer doesn't include the
--- loading screen (which can easily run longer than the timer itself).
local outOfMenuTime = 0
--- Whether the car has been teleported yet. The teleport must happen once,
--- not every frame the state is held for while the car settles.
local placed = false
--- Whether physics writes were permitted, and how long the car was given to
--- come to rest.
local placementReport = ''

--- Writes the outcome where TyPiQL can read it. TyPiQL waits on this file
--- rather than on the images themselves so that a failure is reported
--- explicitly instead of only ever surfacing as a timeout.
local function writeResult(ok, message)
  io.createDir(OUT_DIR)
  io.save(RESULT_FILE, table.concat({
    '[RESULT]',
    'ID=' .. (job and job.id or ''),
    'STATUS=' .. (ok and 'ok' or 'error'),
    'MESSAGE=' .. (message or ''),
    'DAY=' .. (io.exists(DAY_FILE) and DAY_FILE or ''),
    'NIGHT=' .. (io.exists(NIGHT_FILE) and NIGHT_FILE or ''),
    'LIGHTS=' .. lightsReport,
    'START=' .. startReport,
    'PLACEMENT=' .. placementReport,
  }, '\n'))
end

local function finish(ok, message)
  state = 'done'
  status = message
  writeResult(ok, message)
  if job.shutdown then ac.shutdownAssettoCorsa() end
end

local function setState(next, message)
  state = next
  status = message
  stateTime = 0
end

--- Fires a screenshot and advances to `nextState` once CSP reports back.
--- ac.makeScreenshot is asynchronous, so the state machine parks in a
--- dedicated waiting state until the callback lands rather than assuming
--- the file exists on the next frame.
local function shoot(path, nextState, waitMessage)
  shotError = nil
  local finished = false
  ac.makeScreenshot(path, ac.ScreenshotFormat.PNG, function(err)
    finished = true
    shotError = err
  end)
  setState(waitMessage.state, waitMessage.text)
  return function()
    if shotError ~= nil and shotError ~= '' then
      finish(false, 'Screenshot failed: ' .. tostring(shotError))
      return
    end
    if finished then setState(nextState.state, nextState.text) end
  end
end

local pendingShot = nil

--- Whether the frame captured first is the night one. Decided once the
--- session is up, from its actual clock — see where it's set.
local shootingNightFirst = false

--- Whether the session's current time of day counts as night.
---
--- Deliberately generous at both ends: the point is only to work out which
--- of the two frames the session is starting on, and a +12h jump from
--- anywhere in this range lands comfortably in daylight.
local function isNightTime(sim)
  local hour = sim.timeHours
  return hour < 7 or hour >= 19
end

local function phaseName(isNight)
  return isNight and 'night' or 'day'
end

local function fileFor(isNight)
  return isNight and NIGHT_FILE or DAY_FILE
end

local function settleFor(isNight)
  return isNight and job.nightSettle or job.daySettle
end

--- Puts the scene into the state a given phase wants, every frame while it
--- settles.
---
--- Re-asserted rather than set once: other apps can appear a little after
--- the session starts, and the car's own systems can still be initialising,
--- so a single call at the start of the phase doesn't reliably stick.
local function preparePhase(isNight)
  ac.setAppsHidden(true)
  -- Explicit in both directions. The day frame wants the lights off as much
  -- as the night frame wants them on — a car that spawned with them lit
  -- would otherwise carry them into the daylight shot.
  ac.setHeadlights(isNight)
  -- Some cars repurpose the headlight control entirely — ac.StateCar
  -- documents `headlightsAreHeadlights` as "if false, headlights do
  -- something else (like change display mode)", which race cars do. So the
  -- request is read back rather than assumed: if `headlightsActive` doesn't
  -- follow, that's worth knowing before wondering why a night shot is dark.
  local car = ac.getCar(0)
  if car ~= nil then
    lightsReport = string.format(
      'requested=%s active=%s areHeadlights=%s',
      tostring(isNight),
      tostring(car.headlightsActive),
      tostring(car.headlightsAreHeadlights))
  end
end

--- Gets the session running, from whichever callback is actually firing.
---
--- Split out of `update()` because `update()` appears not to tick until the
--- session is already live — which makes it useless for *starting* one. The
--- UI callback registered as `IN_GAME` does run beforehand (CSP's own
--- example of it checks `isInMainMenu`, so it clearly fires in menus), so
--- both call this and whichever runs first wins.
function pumpSessionStart(dt)
  if job == nil or state ~= 'wait_session' then return end

  local sim = ac.getSim()
  if sim == nil then return end
  if not sim.isInMainMenu then
    outOfMenuTime = outOfMenuTime + dt
  end

  -- The API equivalent of pressing Start in the pits menu. This is the call
  -- meant to replace a human pressing the wheel button bound to
  -- __CM_START_STOP_SESSION, which nothing else can press.
  if ac.tryToStart(true) then startedByApi = true end

  -- Move on once the session is live, the call reported success, or enough
  -- time out of the menus has passed that neither is going to happen.
  if sim.isSessionStarted or startedByApi or outOfMenuTime >= START_ATTEMPT_SECONDS then
    waitSeconds = elapsed
    startReport = string.format(
      'startedByApi=%s sessionStarted=%s outOfMenu=%.1fs total=%.1fs',
      tostring(startedByApi), tostring(sim.isSessionStarted), outOfMenuTime, elapsed)
    ac.setAppsHidden(true)
    setState('place_car', 'Moving to ' .. tostring(job.spawnSet))
  end
end

--- Registered via `[UI_CALLBACKS] IN_GAME`. Runs while the pre-drive UI is
--- up, which is exactly when the session needs starting.
function script.inGameUI(dt)
  pumpSessionStart(dt)
end

function script.update(dt)
  if state == 'idle' or state == 'done' then return end

  elapsed = elapsed + dt
  stateTime = stateTime + dt
  if elapsed > job.timeout then
    finish(false, 'Timed out after ' .. math.floor(elapsed) .. 's in state "' .. state .. '"')
    return
  end

  local sim = ac.getSim()

  if state == 'wait_session' then
    pumpSessionStart(dt)

  elseif state == 'place_car' then
    -- Teleporting is preferred over configuring the session's own start
    -- type, because it works whatever the session turned out to be and
    -- lands every car in the same place.
    --
    -- CSP gates writes to the physics engine, and refuses them in contexts
    -- it considers rated. Offline practice should qualify, but if it
    -- doesn't there's no point failing the whole capture over it — the shot
    -- is still usable from wherever the car already is, just possibly with
    -- pit lighting in the night frame.
    if not placed then
      placed = true
      if not job.teleport then
        -- Normal path: the session already spawned the car where the photo
        -- wants it, so leave it alone. Teleporting would only pick the car
        -- up and drop it again.
        placementReport = 'spawned in place, no teleport'
      elseif physics.allowed() then
        physics.teleportCarTo(0, job.spawnSet)
        -- Teleporting drops the car in rather than setting it down: seen
        -- landing hard enough to roll onto its side, and once onto grass.
        -- Clearing the arrival velocity removes the worst of that, but this
        -- is why it's a fallback rather than the default.
        physics.setCarVelocity(0, vec3(0, 0, 0))
      else
        ac.log('typiql: physics not allowed, shooting from the spawn position')
      end
    end

    -- Held here until the car has come to rest. Without it the first frame
    -- can catch the car mid-bounce, or mid-roll.
    -- A car that was never moved doesn't need time to stop moving.
    local settleFor = job.teleport and job.placeSettle or 0
    if stateTime < settleFor then return end
    if job.teleport then
      placementReport = string.format('teleported allowed=%s settled=%.1fs',
        tostring(physics.allowed()), stateTime)
    end

    -- Which frame gets shot first depends on what time the session actually
    -- starts at, rather than assuming daylight. A session configured to
    -- begin near midnight (a sensible choice, since it gets the night frame
    -- somewhere genuinely dark) would otherwise have its two frames saved
    -- under each other's names. The +12h jump flips whichever it is, so the
    -- second phase is always the opposite of the first.
    shootingNightFirst = isNightTime(sim)
    setState('settle_first', 'Settling (' .. phaseName(shootingNightFirst) .. ')')

  elseif state == 'settle_first' then
    preparePhase(shootingNightFirst)
    if stateTime >= settleFor(shootingNightFirst) then
      pendingShot = shoot(fileFor(shootingNightFirst),
        { state = 'flip_time', text = 'Changing time of day' },
        { state = 'shooting_first', text = 'Capturing ' .. phaseName(shootingNightFirst) .. ' frame' })
    end

  elseif state == 'shooting_first' then
    pendingShot()

  elseif state == 'flip_time' then
    -- One instant jump rather than a smooth transition: nothing is being
    -- watched here, and a gradual change would only add settle time.
    ac.setWeatherTimeOffset(job.nightOffset, true)
    setState('settle_second', 'Settling (' .. phaseName(not shootingNightFirst) .. ')')

  elseif state == 'settle_second' then
    preparePhase(not shootingNightFirst)
    if stateTime >= settleFor(not shootingNightFirst) then
      pendingShot = shoot(fileFor(not shootingNightFirst),
        { state = 'finished', text = 'Captured' },
        { state = 'shooting_second', text = 'Capturing ' .. phaseName(not shootingNightFirst) .. ' frame' })
    end

  elseif state == 'shooting_second' then
    pendingShot()

  elseif state == 'finished' then
    finish(true, 'Captured day and night frames')
  end
end

function windowMain()
  ui.text('State: ' .. state)
  ui.text(status)
  if job then
    ui.text('Car: ' .. job.carId)
    ui.text(string.format('Elapsed: %.1fs / %.0fs', elapsed, job.timeout))
  end
  -- The sim flags this script branches on, shown live. When a run stalls,
  -- this is the difference between knowing which condition never came true
  -- and guessing at it.
  local sim = ac.getSim()
  if sim ~= nil then
    ui.text(string.format('inMainMenu=%s sessionStarted=%s',
      tostring(sim.isInMainMenu), tostring(sim.isSessionStarted)))
    ui.text(string.format('startedByApi=%s outOfMenu=%.1fs',
      tostring(startedByApi), outOfMenuTime))
  end
end
