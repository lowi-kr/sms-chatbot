import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/integrations/telnyx.js', () => ({ sendSMS: vi.fn() }));
import { sendSMS } from '../../src/integrations/telnyx.js';
import { deliverReply } from '../../src/core/deliver.js';
import { makeEnv } from '../helpers/env.js';

describe('deliverReply', () => {
  it('logs in exact TEST_MODE true without sending', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await deliverReply(makeEnv({ TEST_MODE: 'true' }), '+1', 'hello');
    expect(sendSMS).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
  it('sends for any other TEST_MODE value', async () => {
    await deliverReply(makeEnv({ TEST_MODE: 'false' }), '+1', 'hello');
    expect(sendSMS).toHaveBeenCalledWith(expect.anything(), '+1', 'hello');
  });
});
