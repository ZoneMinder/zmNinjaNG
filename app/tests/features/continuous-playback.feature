Feature: Continuous event playback
  As a ZoneMinder user
  I want events to play back-to-back
  So that I can review footage without clicking each event

  # The end-of-video auto-advance itself is covered by unit tests
  # (EventDetail.test.tsx, useEventNavigation.test.tsx): driving a real event
  # video to its natural end in a headless browser is slow and flaky. This
  # feature asserts the reliable, user-visible outcome: the toggle is present
  # and its state survives a reload (the setting persists per profile).

  Background:
    Given I am logged into zmNinjaNg

  @web
  Scenario: Continuous-play toggle persists across a reload
    When I navigate to the "Events" page
    And I click into the first event if events exist
    Then the continuous-play toggle is visible if on an event detail page
    When I enable continuous play if on an event detail page
    And I refresh the page
    Then continuous play is still enabled if on an event detail page
