export function makeDb(matchers = []) {
  const calls = [];

  function findMatcher(sql) {
    return matchers.find(({ match }) => sql.includes(match));
  }

  function response(matcher, key) {
    const value = matcher[key];
    if (Array.isArray(value) && key === 'first') return value.shift();
    return value;
  }

  return {
    calls,
    prepare(sql) {
      const matcher = findMatcher(sql);
      const execute = method => async () => {
        const call = { sql, args: [], method };
        calls.push(call);
        if (!matcher) throw new Error(`No fake DB matcher for SQL: ${sql}`);
        if (method === 'first') return response(matcher, 'first');
        if (method === 'all') return { results: response(matcher, 'all') ?? [] };
        return response(matcher, 'run') ?? { meta: { last_row_id: 1, changes: 1 } };
      };
      return {
        first: execute('first'),
        all: execute('all'),
        run: execute('run'),
        bind(...args) {
          const call = { sql, args };
          return {
            async first() {
              calls.push({ ...call, method: 'first' });
              if (!matcher) throw new Error(`No fake DB matcher for SQL: ${sql}`);
              return response(matcher, 'first');
            },
            async all() {
              calls.push({ ...call, method: 'all' });
              if (!matcher) throw new Error(`No fake DB matcher for SQL: ${sql}`);
              return { results: response(matcher, 'all') ?? [] };
            },
            async run() {
              calls.push({ ...call, method: 'run' });
              if (!matcher) throw new Error(`No fake DB matcher for SQL: ${sql}`);
              return response(matcher, 'run') ?? { meta: { last_row_id: 1, changes: 1 } };
            },
          };
        },
      };
    },
  };
}
