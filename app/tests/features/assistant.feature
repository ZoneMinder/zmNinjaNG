@all
Feature: In-app assistant

  Scenario: Assistant is off by default and ? shows keyboard help
    Given I am logged into zmNinjaNg
    When I press the "?" key
    Then I should see the keyboard shortcuts help

  Scenario: The intro suggests a "Summarize my day" example prompt
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    When I press the "?" key
    Then the assistant panel should open
    And I should see the example prompt "Summarize my day"
    When I click the example prompt "Summarize my day"
    Then the assistant input should contain "Summarize my day"

  Scenario: Ask a question that counts events
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will answer "You have 3 events" after calling count_events
    When I press the "?" key
    Then the assistant panel should open
    When I ask "how many events today"
    Then the assistant reply should contain "You have 3 events"
    And an activity chip for "count_events" should have appeared

  Scenario: A conversation that fills the context window is cleared automatically
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant backend has a context window of "1000" tokens
    And the assistant will answer "First answer" using "900" prompt tokens
    When I press the "?" key
    Then the assistant panel should open
    When I ask "how many events today"
    Then the assistant reply should contain "First answer"
    And the context-cleared notice should be visible
    # The notice hides history from the model, not from the user: the answer
    # they just waited for has to stay readable above it.
    And the assistant reply should contain "First answer"

  Scenario: A conversation well inside the context window is left alone
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant backend has a context window of "1000" tokens
    And the assistant will answer "Short answer" using "100" prompt tokens
    When I press the "?" key
    Then the assistant panel should open
    When I ask "how many events today"
    Then the assistant reply should contain "Short answer"
    And the context-cleared notice should not be visible

  Scenario: Destructive action requires confirmation
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will call trigger_alarm on monitor "1"
    When I press the "?" key
    Then the assistant panel should open
    When I ask "trigger the alarm on monitor 1"
    Then the assistant confirm card should be visible
    When I cancel the confirmation
    Then monitor "1" should not be in alarm
    When I ask "trigger the alarm on monitor 1"
    And I confirm the confirmation
    Then monitor "1" should be in alarm
