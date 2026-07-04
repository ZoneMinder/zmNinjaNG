Feature: Event Browsing and Management
  As a ZoneMinder user
  I want to browse, filter, and manage recorded events
  So that I can review incidents and save footage

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Events" page

  @all
  Scenario: Event list loads with real event data
    Then I should see events list or empty state

  @all
  Scenario: Tap event navigates to detail with video player
    When I click into the first event if events exist
    Then I should see event detail elements if on detail page
    When I navigate back if I clicked into an event
    Then I should be on the "Events" page

  @all
  Scenario: Filter events by date range and verify results change
    Then I should see events list or empty state
    When I open the events filter panel
    And I set the events date range
    And I apply event filters
    Then the filtered event set should differ from the unfiltered list
    When I clear event filters
    Then the events list should return to a non-empty state

  @all
  Scenario: Returning from an event keeps the list scroll position
    When I scroll the events list down if it is scrollable
    And I open a visible event after scrolling if the list was scrolled
    And I navigate back to the events list if I opened an event
    Then the events list scroll position should be restored if it was scrolled

  @all
  Scenario: The event back button keeps the list scroll position
    When I scroll the events list down if it is scrollable
    And I open a visible event after scrolling if the list was scrolled
    And I press the event detail back button if I opened an event
    Then the events list scroll position should be restored if it was scrolled

  @all
  Scenario: Clearing the quick time filter keeps the events list usable
    When I select the past week quick time filter
    Then I should see events list or empty state
    When I clear the quick time filter
    Then the quick time filter clear button should be gone
    And I should see events list or empty state

  @all
  Scenario: Filter events by monitor
    When I open the events filter panel
    And I select a monitor filter if available
    And I apply event filters
    Then I should see events list or empty state

  @all
  Scenario: Switch between list and montage views
    When I switch events view to montage
    Then I should see the events montage grid

  @all
  Scenario: Favorite and unfavorite an event
    When I favorite the first event if events exist
    Then I should see the event marked as favorited if action was taken
    When I unfavorite the first event if it was favorited
    Then I should see the event not marked as favorited if action was taken

  @all
  Scenario: Archive and unarchive an event from the list
    When I archive the first event if events exist
    Then I should see the event marked as archived if action was taken
    When I unarchive the first event if it was archived
    Then I should see the event not marked as archived if action was taken

  @all
  Scenario: Archive an event from the detail page
    When I click into the first event if events exist
    And I archive the event from detail page if on detail page
    Then I should see the detail archive button active if action was taken
    When I archive the event from detail page if on detail page
    Then I should see the detail archive button inactive if action was taken

  @all
  Scenario: Favorite an event from the detail page
    When I click into the first event if events exist
    And I favorite the event from detail page if on detail page
    Then I should see the detail favorite button active if action was taken
    When I favorite the event from detail page if on detail page
    Then I should see the detail favorite button inactive if action was taken

  @all
  Scenario: Favorites-only filter shows the favorited event
    When I favorite the first event if events exist
    And I open the events filter panel
    And I enable favorites only filter
    And I apply event filters
    Then I should see the favorited event in the filtered list if action was taken
    When I open the events filter panel
    And I disable favorites only filter
    And I apply event filters
    And I unfavorite the first event if it was favorited

  @all
  Scenario: Filter events to archived only
    When I open the events filter panel
    And I toggle the archived-only filter
    And I apply event filters
    Then I should see events list or empty state

  @all
  Scenario: Filtering by a tag returns only tagged events
    When I open the events filter panel
    And I select the first available tag if tags exist
    And I apply event filters
    Then I should see only tagged events if a tag was applied

  @all
  Scenario: Download event video triggers background task
    When I click into the first event if events exist
    And I click the download video button if video exists
    Then I should see the background task drawer if download was triggered

  @all
  Scenario: Download snapshot from events montage view
    When I switch events view to montage
    Then I should see the events montage grid
    When I download snapshot from first event in montage
    Then I should see the background task drawer if download was triggered

  @web @tauri
  Scenario: Hovering an event thumbnail in list view shows enlarged preview
    When I hover the first event thumbnail if events exist
    Then I should see the enlarged event thumbnail preview if hover was performed

  @ios-phone @android @visual
  Scenario: Phone layout shows readable event cards
    Given the viewport is mobile size
    Then I should see events list or empty state
    And no element should overflow the viewport horizontally
    And the page should match the visual baseline

  @all
  Scenario: Recent events show a human-readable relative time
    Then any relative time labels in the list read as a duration

  @all
  Scenario: Recent events show a relative time in the grid view
    When I switch events view to montage
    Then I should see the events montage grid
    And any relative time labels in the montage read as a duration
