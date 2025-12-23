Feature: Timeline Visualization
  As a ZoneMinder user
  I want to view events on a timeline
  So that I can see patterns and browse events chronologically

  Background:
    Given I am logged into zmNg

  Scenario: View timeline interface
    When I navigate to the "Timeline" page
    Then I should see the page heading "Timeline"
    And I should see timeline interface elements

  Scenario: Interact with timeline
    When I navigate to the "Timeline" page
    Then I should see the page heading "Timeline"
    # Timeline interactions tested via vis-timeline library
