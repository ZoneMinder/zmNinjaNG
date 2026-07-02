Feature: Monitor Detail Page
  As a ZoneMinder user viewing a monitor
  I want to interact with the live feed and controls
  So that I can manage cameras and capture snapshots

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Monitors" page
    And I click into the first monitor detail page

  @all
  Scenario: Video player loads with a connected feed
    Then I should see the monitor player
    And I should see a video player element

  @all
  Scenario: Snapshot button downloads an image
    Then I should see the monitor player
    When I click the snapshot button in monitor detail
    Then I should see snapshot download initiated

  @all
  Scenario: Zone overlay toggle shows and hides zones
    Then I should see the zone toggle button
    When I click the zone toggle button
    Then the zone toggle should be active
    When I click the zone toggle button
    Then the zone toggle should be inactive

  @all
  Scenario: Zone overlay and legend appear when a monitor has zones
    Then I should see the zone toggle button
    When I toggle Show Zones on
    Then the zone overlay and legend should be visible if the monitor has zones
    When I toggle Show Zones off
    Then the zone overlay should not be visible

  @all
  Scenario: Navigation arrows cycle through monitors
    Then I should see navigation arrows if multiple monitors exist
    When I click the next monitor button if visible
    Then the monitor should change to next in list
    When I click the previous monitor button if visible
    Then the monitor should change to previous in list

  @all
  Scenario: Switching monitor updates the live stream, not just the name
    Then I should see the monitor player
    When I note the current monitor stream source
    And I click the next monitor button if visible
    Then the live stream should follow the newly selected monitor

  @all
  Scenario: Mode dropdown shows current mode
    Then I should see the monitor mode dropdown
    And the current mode should be displayed

  @all
  Scenario: Settings dialog opens and closes
    When I open the monitor settings dialog
    Then I should see the monitor settings dialog
    When I press Escape key
    Then the dialog should close

  @all
  Scenario: Settings dialog closes on backdrop tap
    When I click the settings button
    Then I should see the monitor settings dialog
    When I click outside the dialog
    Then the dialog should close

  @web
  Scenario: Scroll wheel zooms the monitor view
    Then I should see the monitor player
    When I scroll the wheel up over the monitor view
    Then the pan controls should be visible

  @web
  Scenario: Keyboard and mouse pan the zoomed view
    Then I should see the monitor player
    When I zoom into the monitor view
    Then the pan controls should be visible
    When I pan the view with the "ArrowRight" arrow key
    Then the view should pan
    When I pan the view with the "ArrowDown" arrow key
    Then the view should pan
    When I drag the monitor view with the mouse
    Then the view should pan

  @ios-phone @android @visual
  Scenario: Phone layout stacks controls below video
    Given the viewport is mobile size
    Then I should see the monitor player
    And no element should overflow the viewport horizontally
    And the page should match the visual baseline

  @all
  Scenario: Recent events list under the live view
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I tap the recent events collapse toggle
    Then the recent events body should be hidden
    When I refresh the page
    Then the recent events body should still be hidden
    When I tap the recent events collapse toggle
    Then the recent events body should be visible
    When I tap "All events"
    Then I should be on the events page filtered to that monitor

  @all
  Scenario: Delete confirm dialog on a recent event can be cancelled
    Given I am logged into zmNinjaNg
    When I open the first monitor's detail view
    Then the recent events list should be visible
    When I tap the delete button on the first recent event
    Then the event delete confirm dialog should be visible
    When I cancel the event delete dialog
    Then the first recent event should still be present
