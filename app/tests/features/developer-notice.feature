Feature: Delete developer notices
  As a zmNinjaNg user
  I want to delete developer notices I have dealt with
  So that the list stays manageable

  Background:
    Given I am logged into zmNinjaNg
    And I am on the developer notices page

  @web
  Scenario: Delete a single notice removes it from the list
    Given the notice list has at least one notice
    When I delete the first notice
    Then the notice count should decrease by one

  @web
  Scenario: Clear all empties the list and Restore brings notices back
    Given the notice list has at least one notice
    When I clear all notices
    Then the notice list should be empty
    When I restore deleted notices
    Then the notice list should not be empty
