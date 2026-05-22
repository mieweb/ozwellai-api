import type {
  OzwellChatProps,
  OzwellConfig,
  OzwellToolCallEventDetail,
  UseOzwellReturn,
} from '../src';

const config: OzwellConfig = {
  apiKey: 'agnt_key-test',
  thinkingEnabled: true,
  thinkingDefaultMode: 2,
  exposeUnreadEvent: true,
};

const props: OzwellChatProps = {
  apiKey: 'agnt_key-test',
  thinkingEnabled: true,
  thinkingDefaultMode: 1,
  exposeUnreadEvent: true,
  onToolCall: (tool, args, sendResult, sendError) => {
    tool.toUpperCase();
    Object.keys(args);
    sendResult({ success: true });
    sendError?.('failed');
  },
};

const directKeyProps: OzwellChatProps = {
  apiKey: 'ozw_test',
  system: 'You are a helpful assistant.',
  tools: [],
};

const detail: OzwellToolCallEventDetail = {
  name: 'update_form',
  arguments: { email: 'a@example.com' },
  respond: (result) => {
    JSON.stringify(result);
  },
  error: (message) => {
    message.toUpperCase();
  },
};

const hookReturn: Pick<UseOzwellReturn, 'sendMessage'> = {
  sendMessage: (content) => {
    content.toUpperCase();
  },
};

// @ts-expect-error thinkingDefaultMode only supports 0=None, 1=Peek, 2=Smart, 3=Expanded.
const invalidMode: OzwellConfig['thinkingDefaultMode'] = 4;

void config;
void props;
void directKeyProps;
void detail;
void hookReturn;
void invalidMode;
