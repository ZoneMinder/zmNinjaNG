Feature: Go2RTC WebRTC Streaming

  Background:
    Given I am on the login page
    When I log in with valid credentials from environment
    Then I should see the dashboard

  Scenario: View monitor with streaming method auto (fallback to MJPEG if WebRTC unavailable)
    Given I am on the montage page
    When I click the first monitor card
    Then I should see the monitor detail page
    And I should see a video player element

  Scenario: View multiple monitors in montage grid with VideoPlayer
    Given I am on the montage page
    Then I should see at least one monitor card
    And each monitor should have a video player element

  Scenario: Download snapshot from video element
    Given I am on the montage page
    When I click the first monitor card
    Then I should see the monitor detail page
    When I click the snapshot button
    Then the snapshot should be saved successfully

  Scenario: Change streaming method in settings (user preference)
    Given I am on the settings page
    When I select the first profile
    Then I should see streaming method setting
    And I can change the streaming method preference

  Scenario: VideoPlayer handles monitor with no profile gracefully
    Given I am logged in
    When viewing a monitor without active profile
    Then the video player should show loading or error state
    And the application should not crash

  Scenario: VideoPlayer ref allows snapshot capture in both streaming modes
    Given I am on a monitor detail page
    And the monitor is streaming
    When I capture a snapshot
    Then the snapshot should contain the current frame
    And the download should complete without errors
