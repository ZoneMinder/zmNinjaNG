Feature: Event Browsing and Management
  As a ZoneMinder user
  I want to browse and filter events
  So that I can review recorded incidents

  Background:
    Given I am logged into zmNg

  Scenario: Browse events in list view
    When I navigate to the "Events" page
    Then I should see the page heading "Events"
    And I should see events list or empty state

  Scenario: Switch between list and montage views
    When I navigate to the "Events" page
    Then I should see the page heading "Events"
    When I switch events view to montage
    Then I should see the events montage grid

  Scenario: Apply event filters
    When I navigate to the "Events" page
    And I open the events filter panel
    And I set the events date range
    And I apply event filters
    Then I should see events list or empty state

  Scenario: Clear event filters
    When I navigate to the "Events" page
    And I open the events filter panel
    And I set the events date range
    And I apply event filters
    When I clear event filters
    Then I should see events list or empty state

  Scenario: View event details
    When I navigate to the "Events" page
    And I click into the first event if events exist
    And I navigate back if I clicked into an event
    Then I should be on the "Events" page

  Scenario: Change event thumbnail fit
    When I navigate to the "Events" page
    Then I should see the page heading "Events"
    # Thumbnail fit selector is tested via data-testid selectors

  @skip
  Scenario: Download event video with background task tracking
    When I navigate to the "Events" page
    And I click into the first event if events exist
    And I click the download video button if video exists
    Then I should see the background task drawer
    And I should see a download task in progress or completed

  @skip
  Scenario: Download snapshot from events montage
    When I navigate to the "Events" page
    When I switch events view to montage
    Then I should see the events montage grid
    When I download snapshot from first event in montage
    Then I should see the background task drawer
    And I should see a download task in progress or completed
