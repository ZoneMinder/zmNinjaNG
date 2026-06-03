Feature: App version display
  As a zmNinjaNg user
  I want to see the app version and build number in the sidebar
  So that I can report exactly which build I am running

  Background:
    Given I am logged into zmNinjaNg

  @web
  Scenario: Sidebar shows marketing version with build number
    Then the sidebar version label should show a version and build number
