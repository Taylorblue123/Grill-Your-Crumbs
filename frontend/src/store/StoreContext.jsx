import { createContext, useContext, useReducer } from 'react';
import { initialState, reducer } from './state.js';

const StateContext = createContext(null);
const DispatchContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useStore() {
  const state = useContext(StateContext);
  if (!state) throw new Error('useStore 必须在 StoreProvider 内使用');
  return state;
}

export function useDispatch() {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error('useDispatch 必须在 StoreProvider 内使用');
  return dispatch;
}
