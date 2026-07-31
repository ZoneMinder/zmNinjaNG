Feature: Live Activity
  As a ZoneMinder user
  I want to see only the cameras that are alarming right now
  So that I can tell what is happening without scanning every tile

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Live Activity" page

  @all
  Scenario: The page reports how many monitors it is watching when nothing is alarming
    Then I should see the all-quiet message
    And the all-quiet message should name how many monitors are being watched

  @all
  Scenario: Fullscreen hides the page chrome and is remembered, without moving Montage
    When I enter Live Activity fullscreen
    Then the Live Activity page chrome should be hidden
    When I refresh the page
    Then the Live Activity page should still be fullscreen
    When I exit Live Activity fullscreen
    Then the Live Activity page chrome should be visible
    And the Montage page should not be fullscreen

  @all
  Scenario: Opening the settings dialog and changing the dwell window persists it
    When I open the Live Activity settings
    And I set the dwell window to 60 seconds
    And I close the Live Activity settings
    And I refresh the page
    And I open the Live Activity settings
    Then the dwell window should be 60 seconds
