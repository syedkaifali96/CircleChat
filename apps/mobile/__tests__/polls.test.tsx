import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import PollsScreen from '../app/(app)/circles/[id]/polls';
import CreatePollScreen from '../app/(app)/circles/[id]/polls/create';
import * as apiModule from '../src/lib/api';

/**
 * M11 mobile polls tests: the polls list renders active/closed polls with
 * results and the caller's selection, voting submits through the API (with
 * the documented delete+re-vote switch), the empty/loading/error states work,
 * and the create screen validates before posting. Network and secure storage
 * are mocked; the server remains authoritative for every rule.
 */

const pushMock = jest.fn();
const backMock = jest.fn();

declare global {
  var __pollsPushMock: jest.Mock | undefined; // hoisted expo-router mock bridge
  var __pollsBackMock: jest.Mock | undefined; // hoisted expo-router mock bridge
}

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNPressable testID={testID}>
        <RNText>{children}</RNText>
      </RNPressable>
    ),
    useRouter: () => ({
      push: (...args: unknown[]) => globalThis.__pollsPushMock?.(...args),
      back: (...args: unknown[]) => globalThis.__pollsBackMock?.(...args),
      replace: jest.fn(),
    }),
    useFocusEffect: (callback: () => void) => {
      // Focus effects fire AFTER mount (like real expo-router) — a synchronous
      // callback would setState during render and loop.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
      const { useEffect } = require('react');
      useEffect(() => {
        callback();
      }, [callback]);
    },
    useLocalSearchParams: () => ({ id: 'c-1' }),
  };
});

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, statusCode: number, message: string) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  fetchPolls: jest.fn(),
  createPoll: jest.fn(),
  votePoll: jest.fn(),
  removePollVote: jest.fn(),
  closePoll: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;

const poll = (overrides: Partial<apiModule.Poll> = {}): apiModule.Poll => ({
  id: 'poll-1',
  conversationId: 'conv-1',
  question: 'Where should we go?',
  options: ['Beach', 'Cinema'],
  votes: [3, 2],
  totalVotes: 5,
  myVote: 0,
  closed: false,
  closesAt: null,
  createdAt: '2026-01-02T00:00:00.000Z',
  createdBy: { userId: 'u-2', username: 'ayesha', displayName: 'Ayesha' },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as { __pollsPushMock?: jest.Mock }).__pollsPushMock = pushMock;
  (globalThis as { __pollsBackMock?: jest.Mock }).__pollsBackMock = backMock;
});

afterEach(() => {
  delete (globalThis as { __pollsPushMock?: jest.Mock }).__pollsPushMock;
  delete (globalThis as { __pollsBackMock?: jest.Mock }).__pollsBackMock;
});

describe('PollsScreen (M11)', () => {
  it('renders active and closed polls with vote counts and my selection', async () => {
    mockApi.fetchPolls.mockResolvedValue({
      polls: [
        poll(),
        poll({ id: 'poll-2', question: 'Movie night?', closed: true, myVote: null, votes: [1, 4], totalVotes: 5 }),
      ],
    });

    render(<PollsScreen />);
    await waitFor(() => expect(screen.getByTestId('poll-card-poll-1')).toBeTruthy());
    expect(screen.getByText('Where should we go?')).toBeTruthy();
    expect(screen.getByText('Movie night?')).toBeTruthy();
    // Results per option.
    expect(screen.getByTestId('poll-votes-poll-1-0').props.children).toBe(3);
    expect(screen.getByTestId('poll-votes-poll-1-1').props.children).toBe(2);
    expect(screen.getByTestId('poll-votes-poll-2-1').props.children).toBe(4);
    // Active/closed sections exist.
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    // The caller's selected option shows the filled marker.
    expect(screen.getByText('● Beach')).toBeTruthy();
  });

  it('submits a vote for an unvoted poll through the API', async () => {
    mockApi.fetchPolls.mockResolvedValue({ polls: [poll({ myVote: null, votes: [1, 2], totalVotes: 3 })] });
    mockApi.votePoll.mockResolvedValue({ poll: poll({ myVote: 1 }) });

    render(<PollsScreen />);
    const option = await screen.findByTestId('poll-option-poll-1-1');
    fireEvent.press(option);

    await waitFor(() => expect(mockApi.votePoll).toHaveBeenCalledWith('test-token', 'poll-1', 1));
  });

  it('switches a vote via the documented delete + re-vote flow', async () => {
    mockApi.fetchPolls.mockResolvedValue({ polls: [poll({ myVote: 0 })] });

    render(<PollsScreen />);
    const option = await screen.findByTestId('poll-option-poll-1-1');
    fireEvent.press(option);

    await waitFor(() => expect(mockApi.removePollVote).toHaveBeenCalledWith('test-token', 'poll-1'));
    await waitFor(() => expect(mockApi.votePoll).toHaveBeenCalledWith('test-token', 'poll-1', 1));
  });

  it('shows a friendly error when the server rejects the vote (POLL_CLOSED)', async () => {
    mockApi.fetchPolls.mockResolvedValue({ polls: [poll({ myVote: null })] });
    mockApi.votePoll.mockRejectedValue(new apiModule.ApiError('POLL_CLOSED', 409, 'closed'));

    render(<PollsScreen />);
    const option = await screen.findByTestId('poll-option-poll-1-0');
    fireEvent.press(option);

    await waitFor(() => expect(screen.getByTestId('polls-action-error').props.children).toBe('This poll is closed.'));
  });

  it('shows the empty state when the Circle has no polls', async () => {
    mockApi.fetchPolls.mockResolvedValue({ polls: [] });

    render(<PollsScreen />);
    await waitFor(() => expect(screen.getByTestId('polls-empty')).toBeTruthy());
  });

  it('shows a loading state while polls load', () => {
    mockApi.fetchPolls.mockImplementation(() => new Promise(() => undefined));

    render(<PollsScreen />);
    expect(screen.getByTestId('polls-loading')).toBeTruthy();
  });

  it('shows an error state with retry when loading fails', async () => {
    mockApi.fetchPolls.mockRejectedValueOnce(new apiModule.ApiError('NOT_FOUND', 404, 'gone'));
    render(<PollsScreen />);
    await waitFor(() => expect(screen.getByTestId('polls-error')).toBeTruthy());

    mockApi.fetchPolls.mockResolvedValue({ polls: [] });
    fireEvent.press(screen.getByTestId('polls-retry'));
    await waitFor(() => expect(screen.getByTestId('polls-screen')).toBeTruthy());
  });
});

describe('CreatePollScreen (M11)', () => {
  it('blocks submission without a question and with fewer than two options', () => {
    render(<CreatePollScreen />);

    fireEvent.press(screen.getByTestId('create-poll-submit'));
    expect(screen.getByTestId('create-poll-error').props.children).toBe('Give your poll a question.');
    expect(mockApi.createPoll).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('create-poll-question'), 'Lunch?');
    fireEvent.changeText(screen.getByTestId('create-poll-option-0'), 'Pizza');
    // option-1 left empty → only one real option.
    fireEvent.press(screen.getByTestId('create-poll-submit'));
    expect(screen.getByTestId('create-poll-error').props.children).toBe('Add at least two options.');
    expect(mockApi.createPoll).not.toHaveBeenCalled();
  });

  it('creates the poll and navigates back on success', async () => {
    mockApi.createPoll.mockResolvedValue({ poll: poll() });

    render(<CreatePollScreen />);
    fireEvent.changeText(screen.getByTestId('create-poll-question'), 'Lunch?');
    fireEvent.changeText(screen.getByTestId('create-poll-option-0'), 'Pizza');
    fireEvent.changeText(screen.getByTestId('create-poll-option-1'), 'Biryani');
    fireEvent.press(screen.getByTestId('create-poll-submit'));

    await waitFor(() =>
      expect(mockApi.createPoll).toHaveBeenCalledWith('test-token', 'c-1', {
        question: 'Lunch?',
        options: ['Pizza', 'Biryani'],
      }),
    );
    await waitFor(() => expect(backMock).toHaveBeenCalled());
  });

  it('adds and removes option inputs within bounds', () => {
    render(<CreatePollScreen />);

    // Add up to the cap of six.
    for (let i = 0; i < 4; i++) {
      fireEvent.press(screen.getByTestId('create-poll-add-option'));
    }
    expect(screen.getByTestId('create-poll-option-5')).toBeTruthy();
    expect(screen.queryByTestId('create-poll-add-option')).toBeNull();

    // Remove back down to the floor of two.
    for (let i = 5; i >= 2; i--) {
      fireEvent.press(screen.getByTestId(`create-poll-remove-${i}`));
    }
    expect(screen.queryByTestId('create-poll-option-2')).toBeNull();
    expect(screen.getByTestId('create-poll-option-1')).toBeTruthy();
  });

  it('surfaces a friendly server error when creation fails', async () => {
    mockApi.createPoll.mockRejectedValue(new apiModule.ApiError('VALIDATION_FAILED', 400, 'bad'));

    render(<CreatePollScreen />);
    fireEvent.changeText(screen.getByTestId('create-poll-question'), 'Lunch?');
    fireEvent.changeText(screen.getByTestId('create-poll-option-0'), 'Pizza');
    fireEvent.changeText(screen.getByTestId('create-poll-option-1'), 'Biryani');
    fireEvent.press(screen.getByTestId('create-poll-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('create-poll-error').props.children).toBe("Couldn't create the poll. Try again."),
    );
  });
});
