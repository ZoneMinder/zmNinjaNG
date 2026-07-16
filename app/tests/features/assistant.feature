@all
Feature: In-app assistant

  Scenario: Assistant is off by default and ? shows keyboard help
    Given I am logged into zmNinjaNg
    When I press the "?" key
    Then I should see the keyboard shortcuts help

  Scenario: Ask a question that counts events
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will answer "You have 3 events" after calling count_events
    When I press the "?" key
    Then the assistant panel should open
    When I ask "how many events today"
    Then the assistant reply should contain "You have 3 events"
    And an activity chip for "count_events" should have appeared

  Scenario: Destructive action requires confirmation
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will call trigger_alarm on monitor "1"
    When I press the "?" key
    And I ask "trigger the alarm on monitor 1"
    Then the assistant confirm card should be visible
    When I cancel the confirmation
    Then monitor "1" should not be in alarm
    When I ask "trigger the alarm on monitor 1"
    And I confirm the confirmation
    Then monitor "1" should be in alarm
