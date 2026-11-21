import { todoWidget } from './todo.definition';

describe('todoWidget calendar source', () => {
  it('exposes its calendar source through a dynamic import', async () => {
    expect(todoWidget.loadCalendarSource).toBeDefined();
    const source = await todoWidget.loadCalendarSource?.();
    expect(source?.name).toMatch(/TodoCalendarSource$/);
  });
});
