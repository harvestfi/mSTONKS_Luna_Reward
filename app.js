require("dotenv").config();
const axios = require("axios");
const Web3 = require("web3");
const BigNumber = require("bignumber.js");
const fs = require("fs");
const _ = require("lodash");
const jsonexport = require("jsonexport");
const POOLABI = require("./ABI/POOL.json");
const VAULTABI = require("./ABI/VAULT.json");
const web3 = new Web3(process.env.INFURAKEY);
BigNumber.config({
  EXPONENTIAL_AT: [-100, 100],
});
const isSameAddress = (a, b) => {
  return a.toLowerCase() === b.toLowerCase();
};
const mSTONKSPools = [
  {
    name: "mTSLA_UST",
    address: "0x40C34B0E1bb6984810E17474c6B0Bcc6A6B46614",
  },
  {
    name: "mAAPL_UST",
    address: "0xc02d1Da469d68Adc651Dd135d1A7f6b42F4d1A57",
  },
  {
    name: "mAMZN_UST",
    address: "0x8Dc427Cbcc75cAe58dD4f386979Eba6662f5C158",
  },
  {
    name: "mGOOG_UST",
    address: "0xfE83a00DF3A98dE218c08719FAF7e3741b220D0D",
  },
];
const totalLuna = 27364;
const lunaAddress = "0xd2877702675e6ceb975b4a1dff9fb7baf4c91ea9";
const lunaPerPool = totalLuna / mSTONKSPools.length;

const main = async () => {
  const precision = 5;
  let i = 0;
  for (let _pool of mSTONKSPools) {
    const poolContract = new web3.eth.Contract(POOLABI, _pool.address);
    const lpToken = await poolContract.methods.lpToken().call();
    const vaultContract = new web3.eth.Contract(VAULTABI, lpToken);
    mSTONKSPools[i].lpToken = lpToken;
    const balance = await vaultContract.methods.balanceOf(_pool.address).call();
    mSTONKSPools[i].balance = balance;
    i++;
  }
  let rewardList = {};
  mSTONKSPools.forEach(async ({ address: pool, name, balance }) => {
    rewardList[pool] = {};
    const apiURL = `https://api.etherscan.io/api?module=account&action=tokentx&address=${pool}&startblock=0&endblock=latest&sort=asc&apikey=${process.env.ETHERSCAN_APIKEY}`;
    const {
      data: { result },
    } = await axios.get(apiURL);
    result.forEach((txn) => {
      const { from, to, value, tokenSymbol, hash } = txn;
      if (isSameAddress(to, pool) && tokenSymbol === "fUNI-V2") {
        //lp deposit action
        if (_.isEmpty(rewardList[pool][from]))
          rewardList[pool][from] = new BigNumber(0);
        rewardList[pool][from] = new BigNumber(rewardList[pool][from]).plus(
          value
        );
      } else if (isSameAddress(from, pool) && tokenSymbol === "fUNI-V2") {
        //withdraw action
        rewardList[pool][to] = new BigNumber(rewardList[pool][to]).minus(value);
      }
    });

    //rewards analyze report
    let analyze = [],
      multisend = [];
    Object.keys(rewardList[pool]).forEach((key) => {
      if (!rewardList[pool][key].isZero()) {
        const percentage = new BigNumber(rewardList[pool][key])
          .dividedBy(balance)
          .multipliedBy(100);
        analyze.push({
          name,
          pool,
          key,
          deposit: web3.utils.fromWei(rewardList[pool][key].toFixed(0)),
          percentage: `${percentage.toFixed(2, 1)}%`,
          reward: new BigNumber(rewardList[pool][key])
            .dividedBy(balance)
            .multipliedBy(lunaPerPool)
            .toString(),
        });
        multisend.push({
          key,
          reward: new BigNumber(rewardList[pool][key])
            .dividedBy(balance)
            .multipliedBy(lunaPerPool)
            .toFixed(precision, 1),
        });
      }
    });
    jsonexport(
      analyze,
      {
        rename: [
          "Pool Name",
          "Pool Address",
          "User Address",
          "Deposit Amount",
          "Share rate",
          "Luna Reward",
        ],
      },
      function (err, csv) {
        if (err) return console.error(err);
        const name = `Rewards-${name}.csv`;
        fs.writeFile(`Analyze/${name}`, csv, "utf8", function (err) {
          if (err) {
            console.log(
              `Some error occured - ${name} file either not saved or corrupted file saved.`
            );
          } else {
            console.log(`Rewards-${name}.csv saved!`);
          }
        });
      }
    );

    //multisender csv
    jsonexport(multisend, { includeHeaders: false }, function (err, csv) {
      if (err) return console.error(err);
      const name = `Multisend-${name}.csv`;
      fs.writeFile(`Multisend/${name}`, csv, "utf8", function (err) {
        if (err) {
          console.log(
            `Some error occured - ${name} file either not saved or corrupted file saved.`
          );
        } else {
          console.log(`Multisend-${name}.csv saved!`);
        }
      });
    });
  });
};

main();
