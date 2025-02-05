import { WalletInfo } from 'bitcoin-core';
import bitcoindService from 'lib/bitcoin/bitcoindService';
import { defaultRepoState } from 'utils/constants';
import { defaultStateBalances, defaultStateInfo, getNetwork } from 'utils/tests';
import { eclairService } from './';
import * as eclairApi from './eclairApi';
import * as ELN from './types';

jest.mock('./eclairApi');
jest.mock('lib/bitcoin/bitcoindService');
jest.mock('utils/async', () => {
  const actualAsync = jest.requireActual('utils/async');
  return {
    waitFor: (conditionFunc: () => Promise<any>): Promise<any> => {
      return actualAsync.waitFor(conditionFunc, 0.1, 0.5);
    },
  };
});

const eclairApiMock = eclairApi as jest.Mocked<typeof eclairApi>;
const bitcoindServiceMock = bitcoindService as jest.Mocked<typeof bitcoindService>;

describe('EclairService', () => {
  const network = getNetwork();
  const node = network.nodes.lightning[2];
  const backend = network.nodes.bitcoin[0];

  it('should get node info', async () => {
    const infoResponse: Partial<ELN.GetInfoResponse> = {
      nodeId: 'asdf',
      alias: '',
      publicAddresses: ['1.1.1.1:9735'],
      blockHeight: 0,
    };
    eclairApiMock.httpPost.mockResolvedValue(infoResponse);
    const expected = defaultStateInfo({
      pubkey: 'asdf',
      rpcUrl: 'asdf@1.1.1.1:9735',
      syncedToChain: true,
    });
    const actual = await eclairService.getInfo(node);
    expect(actual).toEqual(expected);
  });

  it('should get wallet balance', async () => {
    const ballanceResponse: Partial<WalletInfo> = {
      balance: 0.00001,
      unconfirmed_balance: 0,
      immature_balance: 0,
    };
    bitcoindServiceMock.getWalletInfo.mockResolvedValue(ballanceResponse as any);

    const expected = defaultStateBalances({ confirmed: '1000', total: '1000' });
    const actual = await eclairService.getBalances(node, backend);
    expect(actual).toEqual(expected);
  });

  it('should fail to get balance with an invalid backend', async () => {
    const err = 'EclairService getBalances: backend was not specified';
    await expect(eclairService.getBalances(node)).rejects.toThrow(err);
  });

  it('should get new address', async () => {
    const expected = { address: 'abcdef' };
    eclairApiMock.httpPost.mockResolvedValue(expected.address);
    const actual = await eclairService.getNewAddress(node);
    expect(actual).toEqual(expected);
  });

  it('should get a list of channels for < v0.8.0', async () => {
    const chanResponse: ELN.ChannelResponse = {
      nodeId: 'abcdef',
      channelId: '65sdfd7',
      state: ELN.ChannelState.NORMAL,
      data: {
        commitments: {
          channelFlags: 1,
          localParams: {
            isFunder: true,
            isInitiator: undefined as any,
          },
          localCommit: {
            spec: {
              toLocal: 100000000,
              toRemote: 50000000,
            },
          },
          commitInput: {
            amountSatoshis: 150000,
          },
        },
      },
    };
    eclairApiMock.httpPost.mockResolvedValue([chanResponse]);
    const expected = [expect.objectContaining({ pubkey: 'abcdef' })];
    const actual = await eclairService.getChannels(node);
    expect(actual).toEqual(expected);
  });

  it('should get a list of channels for >= v0.8.0', async () => {
    const chanResponse: ELN.ChannelResponse = {
      nodeId: 'abcdef',
      channelId: '65sdfd7',
      state: ELN.ChannelState.NORMAL,
      data: {
        commitments: {
          channelFlags: 1,
          localParams: {
            isFunder: undefined as any,
            isInitiator: true,
          },
          localCommit: {
            spec: {
              toLocal: 100000000,
              toRemote: 50000000,
            },
          },
          commitInput: {
            amountSatoshis: 150000,
          },
        },
      },
    };
    eclairApiMock.httpPost.mockResolvedValue([chanResponse]);
    const expected = [expect.objectContaining({ pubkey: 'abcdef' })];
    const actual = await eclairService.getChannels(node);
    expect(actual).toEqual(expected);
  });

  it('should get a list of peers', async () => {
    const peersResponse: ELN.PeerResponse[] = [
      {
        nodeId: 'abcdef',
        state: 'CONNECTED',
        address: '1.1.1.1:9735',
        channels: 1,
      },
      {
        nodeId: 'hijklm',
        state: 'DISCONNECTED',
        channels: 2,
      },
    ];
    eclairApiMock.httpPost.mockResolvedValue(peersResponse);
    const peers = await eclairService.getPeers(node);
    expect(peers[0].pubkey).toEqual('abcdef');
    expect(peers[0].address).toEqual('1.1.1.1:9735');
    expect(peers[1].pubkey).toEqual('hijklm');
    expect(peers[1].address).toEqual('');
  });

  it('should connect to peers', async () => {
    const peerResponse = { uri: 'abcdef@1.1.1.1:9735' };
    eclairApiMock.httpPost.mockResolvedValueOnce([]); // peers
    eclairApiMock.httpPost.mockResolvedValue(peerResponse); // connect
    const rpcUrls = ['b@2.2.2.2:9735', 'c@3.3.3.3:9735'];
    await eclairService.connectPeers(node, rpcUrls);
    expect(eclairApiMock.httpPost).toBeCalledTimes(3);
    expect(eclairApiMock.httpPost).toBeCalledWith(node, 'connect', { uri: rpcUrls[0] });
    expect(eclairApiMock.httpPost).toBeCalledWith(node, 'connect', { uri: rpcUrls[1] });
  });

  it('should not throw an error when connecting peers', async () => {
    eclairApiMock.httpPost.mockResolvedValueOnce(['p@x.x.x.x:9735']); // peers
    eclairApiMock.httpPost.mockRejectedValue(new Error('test-error')); // connect
    const rpcUrls = ['b@2.2.2.2:9735', 'c@3.3.3.3:9735'];
    await expect(eclairService.connectPeers(node, rpcUrls)).resolves.not.toThrow();
  });

  it('should open a channel', async () => {
    eclairApiMock.httpPost.mockResolvedValueOnce(['p@x.x.x.x:9735']); // peers
    eclairApiMock.httpPost.mockResolvedValueOnce(undefined); // connect
    eclairApiMock.httpPost.mockResolvedValueOnce('txid'); // open
    const rpcUrl = 'abc@1.1.1.1:9735';
    const amountSats = '100000';
    const res = await eclairService.openChannel({
      from: node,
      toRpcUrl: rpcUrl,
      amount: amountSats,
      isPrivate: false,
    });
    expect(res.txid).toEqual('txid');
    expect(res.index).toEqual(0);
  });

  it('should open a private channel', async () => {
    eclairApiMock.httpPost.mockResolvedValueOnce(['p@x.x.x.x:9735']); // peers
    eclairApiMock.httpPost.mockResolvedValueOnce(undefined); // connect
    eclairApiMock.httpPost.mockResolvedValueOnce('txid'); // open
    const rpcUrl = 'abc@1.1.1.1:9735';
    const amountSats = '100000';
    const res = await eclairService.openChannel({
      from: node,
      toRpcUrl: rpcUrl,
      amount: amountSats,
      isPrivate: true,
    });
    expect(res.txid).toEqual('txid');
    expect(res.index).toEqual(0);
    expect(eclairApiMock.httpPost).toHaveBeenCalledWith(
      {
        backendName: 'backend1',
        docker: { command: '', image: '' },
        id: 2,
        implementation: 'eclair',
        name: 'carol',
        networkId: 1,
        ports: { p2p: 9937, rest: 8283 },
        status: 3,
        type: 'lightning',
        version: defaultRepoState.images.eclair.latest,
      },
      'open',
      { channelFlags: 0, fundingSatoshis: 100000, nodeId: 'abc' },
    );
  });

  it('should close a channel', async () => {
    eclairApiMock.httpPost.mockResolvedValueOnce('txid'); // close
    const res = await eclairService.closeChannel(node, 'chanId');
    expect(res).toEqual('txid');
  });

  it('should create an invoice', async () => {
    const createInvResponse: Partial<ELN.CreateInvoiceResponse> = {
      serialized: 'lnbc100xyz',
    };
    eclairApiMock.httpPost.mockResolvedValue(createInvResponse); // createinvoice
    const res = await eclairService.createInvoice(node, 100000);
    expect(res).toEqual('lnbc100xyz');
    expect(eclairApiMock.httpPost).toBeCalledWith(
      node,
      'createinvoice',
      expect.objectContaining({ description: `Payment to ${node.name}` }),
    );
    const res2 = await eclairService.createInvoice(node, 100000, 'test-memo');
    expect(res2).toEqual('lnbc100xyz');
    expect(eclairApiMock.httpPost).toBeCalledWith(
      node,
      'createinvoice',
      expect.objectContaining({ description: 'test-memo' }),
    );
  });

  describe('pay invoice', () => {
    const mockResponses = (v8: boolean) => {
      const payReq = {
        nodeId: 'abcdef',
        amount: 100000,
      };
      const sentInfoResponse = (type: string, failMode?: string) => [
        {
          id: 'invId',
          paymentRequest: v8 ? undefined : payReq,
          invoice: v8 ? payReq : undefined,
          status: {
            type,
            paymentPreimage: 'pre-image',
            failures:
              failMode === 'empty'
                ? []
                : failMode === 'msg'
                ? [
                    {
                      failureMessage: 'sent-error',
                    },
                  ]
                : undefined,
          },
        },
      ];

      eclairApiMock.httpPost.mockResolvedValueOnce('invId'); // payinvoice
      eclairApiMock.httpPost.mockResolvedValueOnce([]); // getsentinfo
      eclairApiMock.httpPost.mockResolvedValueOnce(sentInfoResponse('failed')); // getsentinfo
      eclairApiMock.httpPost.mockResolvedValueOnce(sentInfoResponse('failed', 'empty')); // getsentinfo
      eclairApiMock.httpPost.mockResolvedValueOnce(sentInfoResponse('failed', 'msg')); // getsentinfo
      eclairApiMock.httpPost.mockResolvedValueOnce(sentInfoResponse('sent')); // getsentinfo
      eclairApiMock.httpPost.mockResolvedValue(sentInfoResponse('sent')); // getsentinfo
    };

    it('should pay an invoice for < v0.8.0', async () => {
      mockResponses(false);
      const promise = eclairService.payInvoice(node, 'lnbc100xyz');
      const res = await promise;
      expect(res.preimage).toEqual('pre-image');
      expect(res.amount).toEqual(100000);
      expect(res.destination).toEqual('abcdef');
      // test payments with amount specified
      eclairService.payInvoice(node, 'lnbc100xyz', 1000);
      expect(eclairApiMock.httpPost).toBeCalledWith(
        node,
        'payinvoice',
        expect.objectContaining({
          amountMsat: 1000000,
        }),
      );
    });

    it('should pay an invoice for >= v0.8.0', async () => {
      mockResponses(true);
      const promise = eclairService.payInvoice(node, 'lnbc100xyz');
      const res = await promise;
      expect(res.preimage).toEqual('pre-image');
      expect(res.amount).toEqual(100000);
      expect(res.destination).toEqual('abcdef');
      // test payments with amount specified
      eclairService.payInvoice(node, 'lnbc100xyz', 1000);
      expect(eclairApiMock.httpPost).toBeCalledWith(
        node,
        'payinvoice',
        expect.objectContaining({
          amountMsat: 1000000,
        }),
      );
    });
  });

  describe('waitUntilOnline', () => {
    it('should wait successfully', async () => {
      eclairApiMock.httpPost.mockResolvedValue({ publicAddresses: [] });
      await expect(eclairService.waitUntilOnline(node)).resolves.not.toThrow();
      expect(eclairApiMock.httpPost).toBeCalledTimes(1);
    });

    it('should throw error if waiting fails', async () => {
      eclairApiMock.httpPost.mockRejectedValue(new Error('test-error'));
      await expect(eclairService.waitUntilOnline(node, 0.5, 1)).rejects.toThrow(
        'test-error',
      );
      expect(eclairApiMock.httpPost).toBeCalledTimes(7);
    });
  });
});
