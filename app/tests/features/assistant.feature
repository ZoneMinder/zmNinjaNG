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

  # The assistant has no destructive tools at all (see lib/assistant/tools.ts):
  # a model that tries one is refused in the agent loop and relays the refusal.
  Scenario: Destructive action is refused, nothing executes
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the assistant will call trigger_alarm and then relay the refusal
    When I press the "?" key
    Then the assistant panel should open
    When I ask "trigger the alarm please"
    Then the assistant reply should contain "cannot"
    And monitor "1" should not be in alarm

  # NativeLlm (llama.cpp bridge) runs on iOS and Android (refs #270); Chromium
  # has no real native bridge to fake, so "supported" is driven by the
  # useNativeLlmSupported test seam (window.__nativeLlmMockSupported), the
  # same seam layering as the WebGPU/mock-backend stubs above.
  @ios-phone @android
  Scenario: Native backend option appears when the device reports support, and selecting it shows the download control
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    And the native LLM backend reports as supported
    When I navigate to the "Settings" page
    Then I should see the native backend option
    When I select the native backend
    Then I should see the native model download button

  @ios-phone @android
  Scenario: Native backend option is absent without a supported native LLM backend
    Given I am logged into zmNinjaNg
    And the assistant is enabled with the mock backend
    When I navigate to the "Settings" page
    Then I should not see the native backend option
