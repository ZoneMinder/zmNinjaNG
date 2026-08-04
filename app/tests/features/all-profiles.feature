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
  Scenario: Events montage view renders in All mode with no gate notice
    When I navigate to the "Profiles" page
    And I click the All Servers profile card
    When I navigate to the "Events" page
    And I switch events view to montage
    Then I should see the events montage grid
    And event montage tiles should render with no gate notice

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
