// load env variables
require("dotenv").config();
const { Select, Confirm } = require("enquirer");
const sdk = require("@loopring-web/loopring-sdk");

const {
  INFURA_PROJECT_ID,
  ETH_ACCOUNT_PRIVATE_KEY,
  ETH_ACCOUNT_ADDRESS,
  CHAIN_ID,
  VERBOSE,
  CID0,
} = (function () {
  // eslint-disable-next-line no-undef
  const { env } = process;
  return {
    ...env,
    CHAIN_ID: parseInt(env.CHAIN_ID),
    VERBOSE: /^\s*(true|1|on)\s*$/i.test(env.VERBOSE),
  };
})();

const debug = (...args) => {
  if (VERBOSE) {
    console.log(...args);
  }
};


// initialize provider
const PrivateKeyProvider = require("truffle-privatekey-provider");
const Web3 = require("web3");
const provider = new PrivateKeyProvider(
  ETH_ACCOUNT_PRIVATE_KEY,
  `https://goerli.infura.io/v3/${INFURA_PROJECT_ID}`
);
const web3 = new Web3(provider);

//generate Eddsakey
const signatureKeyPairMock = async (accInfo, exchangeAddress) => {
  const keySeed =
    accInfo.keySeed ||
    sdk.GlobalAPI.KEY_MESSAGE.replace(
      "${exchangeAddress}",
      exchangeAddress
    ).replace("${nonce}", (accInfo.nonce - 1).toString());
  const eddsaKey = await sdk.generateKeyPair({
    web3,
    address: accInfo.owner,
    keySeed,
    walletType: sdk.ConnectorNames.Unknown,
    chainId: parseInt(CHAIN_ID, 10),
  });
  return eddsaKey;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  try {
    const exchangeAPI = new sdk.ExchangeAPI({ chainId: CHAIN_ID });
    const userAPI = new sdk.UserAPI({ chainId: CHAIN_ID });
    const walletAPI = new sdk.WalletAPI({ chainId: CHAIN_ID });
    const  nftAPI = new sdk.NFTAPI({ chainId: CHAIN_ID  });


    // get info from chain / init of LoopringAPI contains process.env.CHAIN_ID
    const { exchangeInfo } = await exchangeAPI.getExchangeInfo();
    debug(exchangeInfo);
    // exchange address can change over time
    const { exchangeAddress } = exchangeInfo;
    debug("exchangeInfo", exchangeAddress);

    // Get the accountId and other metadata needed for sig
    debug("ETH_ACCOUNT_ADDRESS", ETH_ACCOUNT_ADDRESS);
    const { accInfo } = await exchangeAPI.getAccount({
      owner: ETH_ACCOUNT_ADDRESS,
    });
    debug("accInfo", accInfo);
    const { accountId } = accInfo;
    debug("accountId", accountId);

    // Auth to API via signature
    const eddsaKey = await signatureKeyPairMock(accInfo, exchangeAddress);
    const { apiKey } = await userAPI.getUserApiKey({ accountId }, eddsaKey.sk);
    if (/5/.test(CHAIN_ID)) {
      debug("auth:", { eddsaKey, apiKey });
    }     

    

    // get storage id for minting
    const { offchainId } = await userAPI.getNextStorageId(
        { accountId: accountId, sellTokenId:0,  },
        apiKey
      );


    // generate nftTokenAddress
      const counterFactualNftInfo = {
        nftOwner: accInfo.owner,
        nftFactory: sdk.NFTFactory[sdk.ChainId.GOERLI],
        nftBaseUri: "",
      };
      const nftTokenAddress = nftAPI.computeNFTAddress(counterFactualNftInfo).tokenAddress || "";
      console.log("nftTokenAddress", nftTokenAddress);


      // get Fee
    const fee = await userAPI.getNFTOffchainFeeAmt(
      {
        accountId: accInfo.accountId,
        tokenAddress: nftTokenAddress,
        requestType: sdk.OffchainNFTFeeReqType.NFT_MINT,
      },
      apiKey
    );


      // NFT minting details
      const opts = {
        request: {
          exchange: exchangeAddress,
          minterId: accountId,
          minterAddress: accInfo.owner,
          toAccountId: accInfo.accountId,
          toAddress: accInfo.owner,
          nftType: 0,
          tokenAddress: nftTokenAddress,
          nftId: nftAPI.ipfsCid0ToNftID(CID0), //nftId.toString(16),
          amount: "100",
          validUntil: Math.round(Date.now() / 1000) + 30 * 86400,
          storageId: offchainId,
          maxFee: {
            tokenId: 0,
            amount: fee.fees["ETH"].fee ?? "8370000000000000000",
          },
          royaltyPercentage: 5,
          forceToMint: true, 
        },
        web3,
        chainId: parseInt(CHAIN_ID, 10),
        walletType: sdk.ConnectorNames.Unknown,
        eddsaKey: eddsaKey.sk,
        apiKey,
      };

      const mintNFTResult = await userAPI.submitNFTMint(opts);
      const { code, message } = mintNFTResult;
    
      console.log(mintNFTResult);

      
      await sleep(250);
    

    //
  } catch (error) {
    console.error(error);
  } finally {
    // eslint-disable-next-line no-undef
    process.exit(0);
  }
})();
