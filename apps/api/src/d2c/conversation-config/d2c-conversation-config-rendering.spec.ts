import {
  buildMainMenuMessages,
  buildWelcomeMessage,
  isCapabilityEnabled,
  renderConversationMessage,
} from './d2c-conversation-config-rendering';
import { DEFAULT_MESSAGES, EffectiveConversationConfig } from './d2c-conversation-config.types';

function makeConfig(
  overrides: Partial<EffectiveConversationConfig> = {},
): EffectiveConversationConfig {
  return {
    organisationId: 'org-1',
    businessName: 'Boby Bites',
    supportPhone: '0800000000',
    supportEmail: 'help@bobybites.local',
    capabilities: [
      { capability: 'ORDER_SNACKS', enabled: true, displayLabel: '🛒 Order Snacks', sortOrder: 1 },
      { capability: 'MY_ORDERS', enabled: true, displayLabel: '📦 My Orders', sortOrder: 2 },
      { capability: 'MY_REWARDS', enabled: true, displayLabel: '⭐ My Rewards', sortOrder: 3 },
      { capability: 'MY_ACCOUNT', enabled: true, displayLabel: '👤 My Account', sortOrder: 4 },
      {
        capability: 'UPDATE_LOCATION',
        enabled: true,
        displayLabel: '📍 Update My Location',
        sortOrder: 5,
      },
      { capability: 'HELP', enabled: true, displayLabel: '❓ Help', sortOrder: 6 },
    ],
    messages: { ...DEFAULT_MESSAGES },
    ...overrides,
  };
}

describe('renderConversationMessage', () => {
  it('substitutes a variable the message key allows', () => {
    const result = renderConversationMessage('WELCOME', 'Hi {{businessName}}!', {
      businessName: 'XYZ Foods',
    });
    expect(result).toBe('Hi XYZ Foods!');
  });

  it("leaves a variable NOT in that key's allowlist completely untouched (never blanked, never substituted)", () => {
    // MAIN_MENU_PROMPT has an empty allowlist — {{businessName}} is not permitted there.
    const result = renderConversationMessage('MAIN_MENU_PROMPT', 'Hi {{businessName}}', {
      businessName: 'XYZ Foods',
    });
    expect(result).toBe('Hi {{businessName}}');
  });

  it('leaves an unknown/unexpected variable name untouched even within an allowed key (defense in depth)', () => {
    const result = renderConversationMessage('WELCOME', 'Hi {{businessName}} {{secretToken}}', {
      businessName: 'XYZ Foods',
      secretToken: 'should-never-appear',
    });
    expect(result).toBe('Hi XYZ Foods {{secretToken}}');
  });

  it('never permits property-path access — {{order.total}}-style tokens are not even recognized as variables', () => {
    const result = renderConversationMessage('ORDER_CREATED', 'Total: {{order.total}}', {
      total: 3000,
    });
    // The regex only matches \w+ (no dots), so this is left completely untouched.
    expect(result).toBe('Total: {{order.total}}');
  });
});

describe('buildWelcomeMessage / buildMainMenuMessages — the SAME functions the preview endpoint reuses', () => {
  it('renders the welcome message using the tenant business name', () => {
    const config = makeConfig({ businessName: 'XYZ Foods' });
    const message = buildWelcomeMessage(config);
    expect(message).toMatchObject({ type: 'BUTTONS' });
    expect((message as { text: string }).text).toContain('XYZ Foods');
  });

  it('builds the main menu ONLY from enabled capabilities, in sortOrder', () => {
    const config = makeConfig({
      capabilities: [
        { capability: 'MY_REWARDS', enabled: false, displayLabel: '⭐ My Rewards', sortOrder: 1 },
        {
          capability: 'ORDER_SNACKS',
          enabled: true,
          displayLabel: '🛒 Order Snacks',
          sortOrder: 3,
        },
        { capability: 'MY_ORDERS', enabled: true, displayLabel: '📦 My Orders', sortOrder: 2 },
      ],
    });
    const [menu] = buildMainMenuMessages(config);
    const options = (menu as { options: { value: string; label: string }[] }).options;
    expect(options.map((o) => o.value)).toEqual(['MY_ORDERS', 'ORDER_SNACKS']);
  });

  it('a tenant relabeling a capability changes the DISPLAY LABEL only — the routed VALUE stays the stable internal id', () => {
    const config = makeConfig({
      capabilities: [
        {
          capability: 'ORDER_SNACKS',
          enabled: true,
          displayLabel: '🛍️ Shop Products',
          sortOrder: 1,
        },
      ],
    });
    const [menu] = buildMainMenuMessages(config);
    const [option] = (menu as { options: { value: string; label: string }[] }).options;
    expect(option!.value).toBe('ORDER_SNACKS');
    expect(option!.label).toBe('🛍️ Shop Products');
  });
});

describe('isCapabilityEnabled', () => {
  it('returns false for a disabled capability, true for an enabled one', () => {
    const config = makeConfig({
      capabilities: [
        { capability: 'MY_REWARDS', enabled: false, displayLabel: '⭐ My Rewards', sortOrder: 1 },
        {
          capability: 'ORDER_SNACKS',
          enabled: true,
          displayLabel: '🛒 Order Snacks',
          sortOrder: 2,
        },
      ],
    });
    expect(isCapabilityEnabled(config, 'MY_REWARDS')).toBe(false);
    expect(isCapabilityEnabled(config, 'ORDER_SNACKS')).toBe(true);
  });
});
