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
