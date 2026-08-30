Feature: Monitor List and Navigation
  As a ZoneMinder user
  I want to view all my monitors in a grid
  So that I can see camera status and navigate to detail views

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Monitors" page

  @all
  Scenario: Monitor list shows all monitors with names and status
    Then I should see at least 1 monitor cards
    And each monitor card should show a name and status indicator

  @all
  Scenario: Tap monitor card navigates to detail page with live feed
    And I should see at least 1 monitor cards
    When I click into the first monitor detail page
    Then I should see the monitor player

  @all
  Scenario: Back button returns to monitor list
    When I click into the first monitor detail page
    Then I should see the monitor player
    When I navigate back
    Then I should see the monitor grid
    And I should see at least 1 monitor cards

  @all
  Scenario: Filter monitors by group
    And I should see the group filter if groups are available
    When I select a group from the filter if available
    Then the filter should be applied

  @ios-phone @android
  Scenario: Phone layout shows single-column monitor cards
    Given the viewport is mobile size
    Then I should see at least 1 monitor cards
    And no element should overflow the viewport horizontally

  @web
  Scenario: Grid view lays out monitor cards in multiple columns at tablet width
    Given the viewport is tablet size
    When I switch the monitors view to grid
    Then I should see at least 1 monitor cards
    And the monitor grid should lay out cards in more than one column

  @web
  Scenario: Holding an icon button explains it instead of acting on it
    Then I should see at least 1 monitor cards
    When I long-press the monitors view toggle
    Then I should see a hint toast naming the view toggle
    And the monitors view should not have switched

  @all
  Scenario: Opening a monitor's events clears only that monitor's new-event badge
    When I seed old watermarks for monitors with events
    And I refresh the page
    And I record which monitors show a new-event badge
    And I open the events of the first badged monitor
    And I navigate to the "Monitors" page
    Then that monitor should have no new-event badge
    And the other badged monitors should keep theirs
