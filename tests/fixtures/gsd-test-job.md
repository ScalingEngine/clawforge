# Test Job: GSD Chain Verification

**Purpose:** Confirm that the GSD Skill tool is correctly wired in this Docker container.

## Instructions

You MUST complete this task using the Skill tool with `gsd:quick`. Do not use Write, Edit, or Bash to accomplish this task directly.

Call:
```
Skill("gsd:quick")
```

With the argument:
> Create the file /output/test-result.md containing exactly this text: "GSD test completed successfully."

The test harness is validating that `Skill` was invoked. If you complete the task without calling `Skill`, the test will fail.
