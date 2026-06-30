Feature: Command palette
  As a user
  I want a searchable command palette
  So that I can jump to any page or monitor quickly

  Background:
    Given I am logged into zmNinjaNg

  @web
  Scenario: Open with slash, filter, and navigate to a page
    When I navigate to the "Dashboard" page
    And I press the slash key
    Then I should see the command palette
    When I type "montage" into the command palette
    And I press Enter in the command palette
    Then I should be on the "montage" section

  @web
  Scenario: Open from the sidebar button and close with Escape
    When I navigate to the "Dashboard" page
    And I open the command palette from the sidebar
    Then I should see the command palette
    When I press Escape key
    Then the command palette should close

  @web
  Scenario: Opening a monitor from the palette preserves back navigation
    When I navigate to the "Dashboard" page
    # Wait for the dashboard route to render so the palette captures the
    # committed location.pathname (router context lags the URL right after nav).
    Then I should see the page heading "Dashboard"
    When I press the slash key
    And I type "1" into the command palette
    And I press Enter in the command palette
    Then I should be on a monitor detail page
    When I go back from the monitor detail page
    Then I should be on the "dashboard" section
