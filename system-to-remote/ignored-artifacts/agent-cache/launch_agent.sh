#!/usr/bin/env sh
set -e
{ __forkline_emit(){ printf '\033]1337;ForklineEvent=%s\007' "$1"; }; __forkline_emit 'type=agent_started;provider=claude'; claude; __forkline_ec=$?; __forkline_emit "type=agent_exited;provider=claude;code=${__forkline_ec}"; }
