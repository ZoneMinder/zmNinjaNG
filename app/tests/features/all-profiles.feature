Feature: All Servers mode
  As a ZoneMinder user with more than one server profile
  I want to see monitors aggregated across every profile
  So that I can view all my cameras from one place

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Profiles" page
    And I add a second profile named "Second" pointing at the same server

  @web
  Scenario: All Servers card aggregates monitors from every profile
    When I navigate to the "Monitors" page
    Then I record the single-profile monitor card count
    When I navigate to the "Profiles" page
    Then I should see the All Servers profile card
    When I click the All Servers profile card
    Then I should be on the monitors page
    And I should see a monitor profile chip on every monitor card
    And the monitor card count should be double the recorded single-profile count

  # A group is All Servers scoped to a chosen subset, so the whole loop has to
  # hold: create it, aggregate only its member, keep settings the All bucket
  # never sees, and delete it without taking its servers with it.
  @web
  Scenario: a group aggregates only its member and keeps its own settings
    When I navigate to the "Monitors" page
    Then I record the single-profile monitor card count
    When I navigate to the "Profiles" page
    And I create a group named "Backyard" holding only the "Second" profile
    Then I should see the group card for "Backyard"
    When I click the group card for "Backyard"
    Then I should be on the monitors page
    And every monitor profile chip should name "Second"
    And the monitor card count should match the recorded single-profile count
    When I navigate to the "Settings" page
    Then the aggregate streaming mode should be named for "Backyard"
    And the aggregate streaming mode should be "Per server"
    When I set the aggregate streaming mode to "Streaming"
    And I reload the current page
    Then the aggregate streaming mode should be "Streaming"
    # The settings bucket is the group's own, with nothing inherited from and
    # nothing written back to All Servers.
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Settings" page
    Then the aggregate streaming mode should be named for "All Servers"
    And the aggregate streaming mode should be "Per server"
    When I navigate to the "Profiles" page
    And I click the group card for "Backyard"
    When I navigate to the "Settings" page
    Then the aggregate streaming mode should be "Streaming"
    # Not cleanup: the browser context is this scenario's own, so the group
    # dies with it either way. Deleting is the half that has to be asserted -
    # the group goes, its member servers stay.
    When I navigate to the "Profiles" page
    And I delete the group named "Backyard"
    Then I should not see the group card for "Backyard"
    And I should see the "Second" profile card
    And I should see the All Servers profile card

  @web
  Scenario: a partial-failure strip appears when one server is unreachable
    When I navigate to the "Profiles" page
    And I add a profile named "Broken" with an unreachable server
    And I click the All Servers profile card
    Then I should be on the monitors page
    And I should see a profile error strip for "Broken"
    And I should see monitor cards from the healthy profiles

  @web
  Scenario: All Servers merges events from every profile with per-profile chips
    When I navigate to the "Events" page
    Then I record the single-profile event card count
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Events" page
    Then I should see an event profile chip on every event card
    And the event card count should be at least the recorded single-profile count

  @web
  Scenario: deep-linking into a monitor from All mode does not switch the active profile
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    Then I should be on the monitors page
    When I click a monitor card
    Then the URL should match the all-mode monitor detail route
    And the profile switcher should still show All Servers

  @web
  Scenario: All Servers montage shows tiles from every profile
    When I navigate to the "Montage" page
    Then I record the single-profile montage tile count
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Montage" page
    Then I should see a monitor profile chip on every montage tile
    And the montage tile count should be double the recorded single-profile count

  @web
  Scenario: All Servers montage hides one server's monitor without touching the other's
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Montage" page
    Then I should see a monitor profile chip on every montage tile
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    Then every montage show-monitors entry should name its owning server
    When I hide the first montage show-monitors entry
    Then that entry's tile should be gone from the montage grid
    And the other server's tile for the same monitor should still be there
    When I reload the current page
    Then I should see at least 1 monitor in montage grid
    And that entry's tile should be gone from the montage grid
    And the other server's tile for the same monitor should still be there
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I show the hidden montage show-monitors entry again
    Then that entry's tile should be back in the montage grid

  @web
  Scenario: All Servers montage recovers after every monitor is hidden
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Montage" page
    Then I should see at least 1 monitor in montage grid
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I hide every montage show-monitors entry
    Then the montage grid should show no tiles
    When I reload the current page
    Then the montage grid should show no tiles
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I show the first hidden montage show-monitors entry
    Then I should see at least 1 monitor in montage grid

  @web
  Scenario: All Servers montage view controls persist across a reload
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Montage" page
    Then I should see at least 1 monitor in montage grid
    And the montage edit-layout control should be available
    When I set the montage fit to "Fit"
    Then the montage fit should be "Fit"
    When I reload the current page
    Then I should see at least 1 monitor in montage grid
    And the montage fit should be "Fit"

  @web
  Scenario: All Servers Streaming Mode is settable and survives a reload
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Settings" page
    Then the All Servers streaming mode should be "Per server"
    When I set the All Servers streaming mode to "Streaming"
    Then the All Servers streaming mode should be "Streaming"
    When I reload the current page
    Then the All Servers streaming mode should be "Streaming"
    When I set the All Servers streaming mode to "Per server"
    And I reload the current page
    Then the All Servers streaming mode should be "Per server"

  @web
  Scenario: the All Servers stream cap is editable and the montage obeys it
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Settings" page
    And I set the All Servers maximum live streams to "1"
    Then the All Servers maximum live streams should be "1"
    When I navigate to the "Montage" page
    Then the montage grid should show exactly 1 tile
    And the montage stream cap overflow notice should be visible
    # Not cleanup: the browser context is this scenario's own, so the cap it
    # wrote dies with it. The reset button is what these steps cover - that it
    # restores the shipped default and that the montage follows it back up.
    When I navigate to the "Settings" page
    And I reset the All Servers maximum live streams
    Then the All Servers maximum live streams should be back to the shipped default
    When I navigate to the "Montage" page
    Then I should see at least 2 monitor in montage grid
    And the montage stream cap overflow notice should be gone

  @web
  Scenario: the All Servers stream budget is shared between the servers
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Settings" page
    And I set the All Servers maximum live streams to "2"
    Then the All Servers maximum live streams should be "2"
    When I navigate to the "Montage" page
    Then the montage grid should show exactly 2 tile
    And the montage tiles should come from more than one server
    # Reset-button coverage again, not cleanup - see the scenario above.
    When I navigate to the "Settings" page
    And I reset the All Servers maximum live streams
    Then the All Servers maximum live streams should be back to the shipped default

  @web
  Scenario: analysis frames toggle is usable from All Servers mode
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    Then I should be on the monitors page
    When I click a monitor card
    Then the URL should match the all-mode monitor detail route
    And the analysis frames toggle should be inactive
    When I turn analysis frames on
    Then the analysis frames toggle should be active
    When I reload the current page
    Then the analysis frames toggle should be active

  @web
  Scenario: Events montage view renders in All mode with no gate notice
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Events" page
    And I switch events view to montage
    Then I should see the events montage grid
    And event montage tiles should render with no gate notice

  @web
  Scenario: Events filters persist in All mode across a reload
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Events" page
    And I open the events filter panel
    And I enable favorites only filter
    And I close the events filter panel
    When I reload the current page
    And I open the events filter panel
    Then the favorites-only filter should be "on"
    # Not cleanup: every scenario runs in its own browser context, so nothing
    # written to the ALL bucket here outlives it. This is the cleared state
    # persisting, which is the other half of the filter's round-trip.
    When I disable favorites only filter
    And I close the events filter panel
    And I reload the current page
    And I open the events filter panel
    Then the favorites-only filter should be "off"

  @web
  Scenario: Live Activity renders in All mode with no gate notice and an aggregated watch count
    When I navigate to the "Live Activity" page
    Then I record the single-profile Live Activity watched count
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Live Activity" page
    Then Live Activity should render with no gate notice
    And the Live Activity watched count should be double the recorded single-profile count

  @web
  Scenario: All mode remembers the last page visited across a reload
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Live Activity" page
    And I refresh the page
    Then I should be on the "Live Activity" page

  @web
  Scenario: Live Activity settings and fullscreen work in All mode
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Live Activity" page
    And I open the Live Activity settings
    Then I should see the page profile picker
    When I close the Live Activity settings
    And I enter Live Activity fullscreen
    Then the Live Activity page chrome should be hidden
    When I exit Live Activity fullscreen
    Then the Live Activity page chrome should be visible

  @web
  Scenario: Logs page picker switches the per-profile log source
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Logs" page
    Then I should see the page profile picker
    When I switch the Logs page to the ZM server log source
    And I pick a different profile in the Logs page picker
    Then the Logs page picker should show the newly picked profile
    And the logs query should have refired with a different access token

  @web
  Scenario: Notifications page overview shows both profiles and switching updates the active row
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Notifications" page
    Then I should see the page profile picker
    And I should see a notification overview row for every profile
    When I click a different profile's notification overview row
    Then that row should be marked as the active profile

  @web
  Scenario: disabling a profile hides the All Servers card until it is re-enabled
    When I navigate to the "Profiles" page
    Then I should see the All Servers profile card
    # Adding "Second" (Background) switched the active profile to it - switch
    # to All mode first so disabling it below targets a non-active profile.
    When I click the All Servers profile card
    When I navigate to the "Profiles" page
    And I disable the "Second" profile
    Then I should not see the All Servers profile card
    When I enable the "Second" profile
    Then I should see the All Servers profile card

  @web
  Scenario: the command palette lists a monitor from every server and opens the owning one
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    Then I should be on the monitors page
    When I record the first monitor name
    And I press the slash key
    Then I should see the command palette
    When I type the recorded monitor name into the command palette
    Then the palette should list that monitor once per server, each labelled with its server
    When I press Enter in the command palette
    Then the URL should match the all-mode monitor detail route
    And the monitor detail page should show the recorded monitor

  @web
  Scenario: navigation shortcuts still work in All Servers mode
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    Then I should be on the monitors page
    When I press the "e" navigation key
    Then I should be on the "events" section

  @web
  Scenario: All Servers aggregation excludes a disabled profile
    When I navigate to the "Monitors" page
    Then I record the single-profile monitor card count
    When I navigate to the "Profiles" page
    And I add a profile named "Disabled" pointing at the same server
    # Adding it switched the active profile to it - switch to All mode first
    # so disabling it below targets a non-active profile.
    And I click the All Servers profile card
    When I navigate to the "Profiles" page
    And I disable the "Disabled" profile
    When I navigate to the "Monitors" page
    Then the monitor card count should be double the recorded single-profile count

  # Whether a tile can be scrolled far enough out to be gated depends on how
  # many monitors the server has and how tall the window is, so this asserts
  # the half that does not: with off-screen pausing on, a tile in view still
  # streams. Every way the observer can fail to report - a ref the grid never
  # calls, a callback identity that churns - leaves the tile gated and this
  # scenario red, and both of those shipped once. Which tile goes quiet when
  # is covered in Montage.test.tsx, where positions are reported rather than
  # produced by a real layout.
  @web
  Scenario: All Servers montage keeps streaming the tiles in view with off-screen pausing on
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Settings" page
    And I turn All Servers off-screen tile pausing "on"
    When I navigate to the "Montage" page
    Then I should see at least 2 monitor in montage grid
    And the first montage tile should be streaming
    # Not cleanup: every scenario runs in its own browser context and logs in
    # from the setup page, so nothing written to the ALL bucket here outlives
    # it. This is the switch's other direction, which nothing else covers.
    When I navigate to the "Settings" page
    And I turn All Servers off-screen tile pausing "off"
    Then All Servers off-screen tile pausing should be "off"

