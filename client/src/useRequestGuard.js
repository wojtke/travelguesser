import { useEffect, useRef } from 'react';

// Async results belong to both a view (filter/tab/selection) and its latest request.
export default function useRequestGuard(scope) {
  const sequence = useRef(0),
    currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(
    () => () => {
      sequence.current++;
    },
    [scope],
  );
  return () => {
    const version = ++sequence.current;
    return () => version === sequence.current && scope === currentScope.current;
  };
}
