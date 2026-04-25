// セッション永続化の DTO 型は shared モジュールに集約済み。
// main 側コードの import 互換性のため、ここから re-export する。
export {
  SESSION_STATE_VERSION,
  SESSION_STATE_MAX_NODES,
  SESSION_STATE_MAX_LEAVES,
  type SerializedDirection,
  type SerializedTerminalPane,
  type SerializedSplitNode,
  type SerializedNode,
  type SerializedMeta,
  type SerializedLayout,
} from "../../shared/session-state-validator";
