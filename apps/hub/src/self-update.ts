import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { version as buildVersion } from '../package.json';

type Update = { version: string };
export type UpdatePhase =
  | { phase: 'idle' | 'checking' | 'current' }
  | { phase: 'available' | 'installing'; update: Update }
  | { phase: 'error'; operation: 'check' | 'install' };

export interface SelfUpdate {
  version: string;
  state: UpdatePhase;
  enabled: boolean;
  check: () => void;
  install: () => void;
}

export function useSelfUpdate(native: boolean, beforeInstall: () => Promise<boolean>): SelfUpdate {
  const [version, setVersion] = useState(buildVersion);
  const [state, setState] = useState<UpdatePhase>({ phase: 'idle' });
  const mounted = useRef(false);
  const busy = useRef(false);
  const started = useRef(false);

  async function check(background: boolean) {
    if (!native || busy.current) return;
    busy.current = true;
    setState({ phase: 'checking' });
    try {
      const update = await invoke<Update | null>('self_update_check');
      if (mounted.current) setState(update ? { phase: 'available', update } : { phase: background ? 'idle' : 'current' });
    } catch (error) {
      console.error('No se pudo buscar actualizaciones de Nexo.', error);
      if (mounted.current) setState(background ? { phase: 'idle' } : { phase: 'error', operation: 'check' });
    } finally {
      busy.current = false;
    }
  }

  async function install() {
    if (!native || busy.current || state.phase !== 'available') return;
    busy.current = true;
    setState({ phase: 'installing', update: state.update });
    try {
      if (!(await beforeInstall())) {
        if (mounted.current) setState({ phase: 'available', update: state.update });
        return;
      }
      await invoke('self_update_install');
    } catch (error) {
      console.error('No se pudo instalar la actualización de Nexo.', error);
      if (mounted.current) setState({ phase: 'error', operation: 'install' });
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (native && !started.current) {
      started.current = true;
      void invoke<string>('app_version')
        .then((value) => {
          if (mounted.current && value) setVersion(value);
        })
        .catch((error) => console.error('No se pudo leer la versión de Nexo.', error));
      void check(true);
    }
    return () => {
      mounted.current = false;
    };
  }, [native]);

  return {
    version,
    state,
    enabled: native,
    check: () => {
      void check(false);
    },
    install: () => {
      void install();
    },
  };
}
