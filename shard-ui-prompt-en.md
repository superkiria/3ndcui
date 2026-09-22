# Codex task: shard management UI prototype

Build a simple interactive UI prototype for managing masters and replicas in a sharded database. The prototype will be demonstrated to the operations/support team to discuss usability and the master switchover workflow.

Deliver a working React website with demo data and no backend. Do not stop at a plan: implement the prototype and provide run instructions.

## 1. Technology and constraints

- If a project already exists, use its structure and dependencies.
- For a new project, use React + TypeScript + Vite and plain CSS.
- Keep all data and changes in React state. Resetting on page reload is acceptable.
- No server, database, authentication, external APIs, complex state manager, or separate mock API layer is needed.
- The entire user interface must be in Russian, even though this prompt is in English.
- Target a laptop or desktop work screen.
- Prioritize simplicity and clarity for the operations team. Do not add features beyond these requirements.

## 2. System model

There are 12 logical shards, represented as replication groups G01–G12. Each group has three instances containing the same data, one in each data center: «ЦОД A», «ЦОД B», and «ЦОД C». There are 36 instances in total.

Number instances sequentially: G01 contains #1, #2, #3; G02 contains #4, #5, #6; …; G12 contains #34, #35, #36. Within each triplet, the first instance is in data center A, the second in B, and the third in C.

Normally, each group has one master and two replicas. Initially distribute masters evenly: four per data center. For reproducibility, assign masters cyclically: G01 in A, G02 in B, G03 in C, then repeat this pattern.

Keep role (master/replica), availability (available/unavailable), and replication lag in milliseconds separate. An unavailable instance retains its role. Do not show lag for masters. Give healthy replicas small fixed lag values no greater than 1000 ms.

## 3. Main screen

Title: «Управление шардами». Display a prominent «Демонстрационный режим» label nearby.

At the top, show a compact summary: number of problematic groups, number of unavailable instances, and number of masters in each data center. The summary describes the entire system regardless of table filters.

The main view is a 12-row table with columns «Группа», «ЦОД A», «ЦОД B», «ЦОД C», and «Состояние».

Each instance cell shows its number, role, availability, and lag for an available replica. Make masters easy to identify visually. Indicate problems with text and color, not color alone.

Above the table, provide search by group ID or exact instance number and a «Только проблемные» toggle. Searching for an instance shows its entire group. Search and the filter work together. Include an empty-results message.

A group is problematic if any instance is unavailable or any replica has lag greater than 1000 ms. This is an arbitrary demo rule, not a production database requirement.

Clicking a row opens a side panel with group details.

## 4. Group panel

Show the group ID, current master and its data center, all three instances with their roles, availability and lag, and a «Переключить мастер» button. Do not add technical metrics that are not specified here.

## 5. Master switchover

1. The user clicks «Переключить мастер».
2. The user chooses one of the two replicas.
3. The UI shows readiness checks.
4. The user confirms the switchover.
5. The UI simulates execution.
6. The user sees the result.

A target instance is eligible if it is available and its lag is no greater than 1000 ms. Ineligible options remain visible with an explanation of why they are disabled. Disable confirmation until a target is selected.

The current master must also be available for this planned switchover. Otherwise, disable the action and explain why. Do not implement emergency master promotion.

Before confirmation, explicitly show the group, source instance and data center, and target instance and data center. Example: «G01: мастер №1 в ЦОД A → №2 в ЦОД B».

Confirmation button: «Подтвердить переключение». Allow cancellation before execution starts.

Simulate execution over 2–3 seconds. Show the stages «Проверка», «Переключение», and «Завершение», along with a label explaining that this is a simulation.

While an operation is running, disable duplicate execution, demo scenario changes, and data reset. For simplicity, allow only one operation at a time across the entire prototype.

On success, the target becomes the master, the previous master becomes a replica with a small demo lag, and the third instance keeps its role. Immediately update the table, panel, and summary. Exactly one master must remain in the group.

Support a simulated failure during the preliminary check, before any role changes. In this case, roles remain unchanged, the user sees the reason, and retrying is possible. Do not mark subsequent stages as completed after a failure. Do not simulate a real database control protocol or complex rollback.

## 6. Demo scenarios

Add a compact «Демо-сценарии» section:

- «Всё исправно» — all instances are healthy.
- «Реплика отстаёт» — one G01 replica has 8000 ms lag; the other remains eligible for switchover.
- «Реплика недоступна» — one G01 replica is unavailable; the other remains healthy.

Selecting a scenario loads a predefined dataset and clears history. Make G01 convenient for demonstrating all scenarios.

Also add a toggle labeled «Следующее переключение завершится ошибкой». It applies to one started operation, then automatically turns off. Cancelling before execution does not consume it. Clearly label the resulting error as simulated.

Add a «Сбросить демо» button: restore the healthy initial state, clear history, search and filters, turn off simulated failure, and close any unfinished switchover form.

## 7. Operation history

Below the table, show a simple list of operations from the current session: time, group, source and target, status («Выполняется», «Успешно», or «Ошибка»), and the error reason when applicable. Create an entry when execution starts and update it when the operation finishes.

No separate history pages or complex filters are needed.

## 8. Visual design and usability

Use a restrained operational tool design: a light background, readable table, consistent spacing, and minimal decoration. Do not add navigation to nonexistent sections, charts, logos, or decorative dashboards.

Use standard accessible controls. Provide clear ways to close the side panel and dialog. Buttons must have unambiguous labels, and disabled actions must have explanations.

## 9. Out of scope

- Real database operations.
- Bulk master relocation.
- Emergency failover.
- Authentication and permissions.
- Topology configuration and adding shards.
- Persistent operation history.
- Additional metrics and monitoring.

## 10. Acceptance checks and delivery

Verify that:

- the UI displays 12 groups and 36 instances;
- there are initially four masters per data center;
- search and filtering work;
- a healthy replica can become the master;
- an unavailable or excessively lagging replica cannot be selected, and the reason is visible;
- success updates all views and preserves exactly one master per group;
- a simulated error leaves roles unchanged;
- duplicate execution is blocked while an operation is running;
- history and demo reset work.

Run the available build check and verify the main workflow in a browser if possible. Do not create a complex testing infrastructure.

Finish with a brief explanation of what was implemented, how to run it, and what was verified. When a decision can be made without clarification, choose the simplest option within these requirements.
