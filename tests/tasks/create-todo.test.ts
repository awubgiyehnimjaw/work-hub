import { expect, test } from "vitest";
import { createTodo } from "@/lib/tasks/create-todo";

test("creates an active todo task with the given title and due date", async () => {
  const task = await createTodo({ title: "Call the client", dueAt: new Date("2026-02-01T00:00:00Z") });
  expect(task.type).toBe("todo");
  expect(task.status).toBe("active");
  expect(task.title).toBe("Call the client");
  expect(task.dueAt).toEqual(new Date("2026-02-01T00:00:00Z"));
});

test("creates a todo with a null due date when none is given", async () => {
  const task = await createTodo({ title: "Loose idea", dueAt: null });
  expect(task.dueAt).toBeNull();
});
