Feature: Montage Live Grid
  As a ZoneMinder user
  I want to see all monitors in a live montage grid
  So that I can view multiple camera feeds simultaneously

  Background:
    Given I am logged into zmNinjaNg
    When I navigate to the "Montage" page

  @all
  Scenario: Montage grid shows monitor feeds with names
    Then I should see at least 1 monitor in montage grid
    And each montage cell should show a monitor name label

  @all
  Scenario: Tap monitor in montage navigates to detail
    Then I should see at least 1 monitor in montage grid
    When I click into the first monitor detail page
    Then I should see the monitor player

  @web
  Scenario: Montage tile is keyboard-focusable and Enter opens its detail page
    Then I should see at least 1 monitor in montage grid
    When I focus the first montage tile with the keyboard
    And I press Enter on the focused montage tile
    Then I should see the monitor player

  @all
  Scenario: Snapshot download from montage
    Then I should see at least 1 monitor in montage grid
    When I click the snapshot button on the first montage monitor
    Then the snapshot should be saved successfully

  @ios-phone @android
  Scenario: Phone portrait shows 1-2 columns with readable feeds
    Given the viewport is mobile size
    Then I should see at least 1 monitor in montage grid
    And no element should overflow the viewport horizontally

  @web
  Scenario: Montage grid lays out tiles in more than one column at tablet width
    Given the viewport is tablet size
    Then I should see at least 1 monitor in montage grid
    And the montage grid should lay out tiles in more than one column

  @all
  Scenario: Hide a monitor from the montage view via the kebab menu
    Then I should see at least 1 monitor in montage grid
    When I capture the first montage monitor id
    And I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I uncheck the visibility for the captured monitor
    Then the captured monitor tile should not be present in the montage grid
    When I reload the current page
    Then I should see at least 1 monitor in montage grid
    And the captured monitor tile should not be present in the montage grid
    When I open the montage kebab menu
    And I open the montage show-monitors submenu
    And I check the visibility for the captured monitor
    Then the captured monitor tile should be present in the montage grid

  @all
  Scenario Outline: Montage renders exactly the selected number of columns
    Then I should see at least 1 monitor in montage grid
    When I set the montage column count to <cols>
    Then the montage grid should render <cols> columns

    Examples:
      | cols |
      | 2    |
      | 5    |

  @web
  Scenario: Montage arrangements follow the selected group
    Then I should see at least 1 monitor in montage grid
    When I record whether two montage groups are selectable
    And I select montage group A and apply 2 columns
    And I select montage group B and apply 3 columns
    And I re-select montage group A
    Then the montage layout should show 2 columns for group A
    When I reload the current page
    And I re-select montage group A
    Then the montage layout should show 2 columns for group A

  @web
  Scenario: The edit-mode scroll pad scrolls the grid without reordering monitors
    Then I should see at least 1 monitor in montage grid
    When I set the montage column count to 1
    Then the montage scroll pad should be hidden
    When I enter montage edit mode
    Then the montage scroll pad should be visible
    When I record the montage grid scroll position and tile order
    And I tap the montage scroll pad down button
    Then the montage grid should have scrolled down
    And the montage tile order should be unchanged
    When I tap the montage scroll pad top button
    Then the montage grid should be scrolled to the top
    When I leave montage edit mode
    Then the montage scroll pad should be hidden

  @web
  Scenario: The kebab menu shows and hides the scroll pad outside edit mode
    Then I should see at least 1 monitor in montage grid
    And the montage scroll pad should be hidden
    When I toggle the montage scroll pad from the menu
    Then the montage scroll pad should be visible
    When I toggle the montage scroll pad from the menu
    Then the montage scroll pad should be hidden

  @web
  Scenario: Montage tile shows the new-events badge and opens filtered events
    Then I should see at least 1 monitor in montage grid
    When I seed old watermarks for montage monitors with events
    And I reload the current page
    Then I should see at least 1 monitor in montage grid
    And a montage tile should show the new-events badge
    When I click the events button on a badged montage tile
    Then the events page should open filtered to that monitor since the watermark
