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
