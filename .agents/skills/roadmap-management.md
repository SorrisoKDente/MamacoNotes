---
name: roadmap-management
description: Rules for maintaining the project's ROADMAP.md files. Ensures that items are only removed or marked as completed after explicit user confirmation of the fix or feature.
---

# Roadmap Management Protocol

## Core Rule
**Items must NEVER be removed from `docs/ROADMAP.md` or `docs/ROADMAP.pt-BR.md` based solely on the AI's implementation claim.**

## Workflow
1.  **Implementation**: After applying a fix or a new feature listed in the roadmap, the agent should report the task as done.
2.  **Verification Wait**: The agent MUST NOT update the roadmap files in the same turn as the code modification.
3.  **User Confirmation**: The agent must explicitly ask the user to verify the change.
    *   *Example*: "I have implemented the batch delete confirmation. Please test it. Once you confirm it works as expected, I will remove it from the Roadmap."
4.  **Roadmap Update**: ONLY when the user replies with a confirmation (e.g., "It works," "Bug fixed," "Confirmed"), the agent shall:
    *   Activate this skill.
    *   Remove the corresponding item from both English and Portuguese versions of the roadmap.
    *   If applicable, move the item to a "Completed" section or simply delete it if requested by the user's workflow.

## Guidelines
- Always sync changes between `ROADMAP.md` and `ROADMAP.pt-BR.md`.
- Maintain the alphabetical or priority order when adding new items.
- If a user reports a NEW bug or improvement, add it to the roadmap immediately after the investigation phase.
