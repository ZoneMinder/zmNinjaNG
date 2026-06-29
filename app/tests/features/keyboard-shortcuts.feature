Feature: Global Keyboard Shortcuts
  As a desktop/web user
  I want to navigate with the keyboard
  So that I can move around quickly without the mouse

  Background:
    Given I am logged into zmNinjaNg

  @web
  Scenario: Letter keys navigate between sections
    When I navigate to the "Dashboard" page
    And I press the "e" navigation key
    Then I should be on the "events" section
    When I press the "m" navigation key
    Then I should be on the "montage" section

  @web
  Scenario: Help overlay opens and closes
    When I navigate to the "Dashboard" page
    And I open the keyboard shortcuts help
    Then I should see the keyboard shortcuts help
    When I press Escape key
    Then the keyboard shortcuts help should close

  @web
  Scenario: Number keys jump to a monitor by position
    When I navigate to the "Monitors" page
    And I jump to monitor number "1"
    Then I should be on a monitor detail page
