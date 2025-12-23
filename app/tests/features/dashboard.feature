Feature: Dashboard Customization
  As a ZoneMinder user
  I want to customize my dashboard with widgets
  So that I can see the information I care about

  Background:
    Given I am logged into zmNg

  Scenario: Add a timeline widget
    When I navigate to the "Dashboard" page
    Then I should see the page heading "Dashboard"
    When I open the Add Widget dialog
    And I select the "Timeline" widget type
    And I enter widget title "Test Timeline"
    And I click the Add button in the dialog
    Then the widget "Test Timeline" should appear on the dashboard

  Scenario: Add a monitor widget with selection
    When I navigate to the "Dashboard" page
    Then I should see the page heading "Dashboard"
    When I open the Add Widget dialog
    And I select the "Monitor Stream" widget type
    And I select the first monitor in the widget dialog
    And I enter widget title "Test Monitor"
    And I click the Add button in the dialog
    Then the widget "Test Monitor" should appear on the dashboard

  Scenario: View dashboard without widgets
    When I navigate to the "Dashboard" page
    Then I should see the page heading "Dashboard"
    # Empty dashboard state tested via EmptyState component
