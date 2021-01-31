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
  ROUNDING_MODE: 1,
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
const weeks = 4;
const lunaPerPool = totalLuna / mSTONKSPools.length / weeks;

const updateRewardFromStakeAmount = (stakeAmount, rewardPool, rate) => {
  for (const [address, amount] of Object.entries(stakeAmount)) {
    rewardPool[address] = new BigNumber(rewardPool[address] || 0).plus(
      amount.dividedBy(rate)
    );
  }
  return rewardPool;
};

const main = async () => {
  const precision = 5;
  const startBlock = 11688056;
  const endBlock = 11761138;
  const { timestamp: startBlockTimestamp } = await web3.eth.getBlock(
    startBlock
  );
  const { timestamp: endBlockTimestamp } = await web3.eth.getBlock(endBlock);

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

  let rewardPool = {}; // reward amount per pool
  let stakeAmount = {}; // reward amount per pool

  const period = endBlockTimestamp - startBlockTimestamp; // total period
  const unitReward = new BigNumber(lunaPerPool).dividedBy(period); // unit reward amount

  for (const { address: pool, name, balance, lpToken } of mSTONKSPools) {
    rewardPool[pool] = {}; // reward amount per address
    stakeAmount[pool] = {}; // stake amount per address

    let prevTimeStamp = startBlockTimestamp;
    let rewardTimeSum = period; // total reward calculated period (due to 0 stake amount period)
    let stakeSum = new BigNumber(0); // total stake amount

    for (let page = 1; ; page++) {
      // deposit/withdraw transactions from etherscan API.
      const apiURL = `https://api.etherscan.io/api?module=account&action=tokentx&contractAddress=${lpToken}&address=${pool}&page=${page}&offset=5000&endblock=${endBlock}&sort=asc&apikey=${process.env.ETHERSCAN_APIKEY}`;
      const {
        data: { result },
      } = await axios.get(apiURL);

      for (const txn of result) {
        const { from, to, value, tokenSymbol, blockNumber } = txn;
        const timeStamp = parseInt(txn.timeStamp);

        if (timeStamp > prevTimeStamp) {
          // calculate reward (prevTimeStamp ~ timeStamp)
          if (stakeSum.isZero()) {
            rewardTimeSum -= timeStamp - prevTimeStamp; // remove 0 stake amount period
          } else {
            updateRewardFromStakeAmount(
              stakeAmount[pool],
              rewardPool[pool],
              stakeSum.dividedBy(
                unitReward.multipliedBy(timeStamp - prevTimeStamp)
              )
            );
          }
          prevTimeStamp = timeStamp;
        }

        if (isSameAddress(to, pool) && tokenSymbol === "fUNI-V2") {
          //lp deposit action - update stake amount
          stakeAmount[pool][from] = new BigNumber(
            stakeAmount[pool][from] || 0
          ).plus(value);
          stakeSum = stakeSum.plus(value);
        } else if (isSameAddress(from, pool) && tokenSymbol === "fUNI-V2") {
          //withdraw action - update stake amount.
          stakeAmount[pool][to] = new BigNumber(
            stakeAmount[pool][to] || 0
          ).minus(value);
          stakeSum = stakeSum.minus(value);
        }
      }

      if (!result.length) {
        break;
      }
    }

    if (endBlockTimestamp > prevTimeStamp) {
      // update reward pool - (prevTimeStamp ~ endBlockTimestamp)
      updateRewardFromStakeAmount(
        stakeAmount[pool],
        rewardPool[pool],
        stakeSum.dividedBy(
          unitReward.multipliedBy(endBlockTimestamp - prevTimeStamp)
        )
      );
    }

    // update reward pool (period / rewardTimeSum)
    for (const [address, amount] of Object.entries(rewardPool[pool])) {
      rewardPool[pool][address] = amount
        .multipliedBy(period)
        .dividedBy(rewardTimeSum);
    }

    console.log("pool: ", pool);
    console.log("endBlock: ", endBlock);
    console.log("endBlockTimestamp: ", endBlockTimestamp);
    console.log("stakeAmount");
    for (const [address, amount] of Object.entries(stakeAmount[pool])) {
      console.log(
        `address: ${address}, amount: ${web3.utils.fromWei(amount.toFixed(0))}`
      );
    }
    console.log("stakeSum", web3.utils.fromWei(stakeSum.toFixed(0)));

    console.log("rewardPool");
    for (const [address, amount] of Object.entries(rewardPool[pool])) {
      console.log(`address: ${address}, amount: ${amount.toString()}`);
    }

    let rewardPoolSum = new BigNumber(0); // total stake amount
    for (const [_, amount] of Object.entries(rewardPool[pool])) {
      rewardPoolSum = rewardPoolSum.plus(amount);
    }
    console.log("rewardPoolSum", rewardPoolSum.toString());

    let analyze = [],
      multisend = [];
    Object.keys(rewardPool[pool]).forEach((key) => {
      if (!rewardPool[pool][key].isZero()) {
        const percentage = new BigNumber(rewardPool[pool][key])
          .dividedBy(rewardPoolSum)
          .multipliedBy(100);
        analyze.push({
          name,
          pool,
          key,
          deposit: web3.utils.fromWei(stakeAmount[pool][key].toFixed(0)),
          percentage: `${percentage.toFixed(4, 0)}%`,
          reward: rewardPool[pool][key].toString(),
        });
        multisend.push({
          key,
          reward: rewardPool[pool][key].toFixed(precision, 1),
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
        fs.writeFile(
          `Analyze/Rewards-${name}.csv`,
          csv,
          "utf8",
          function (err) {
            if (err) {
              console.log(
                `Some error occured - Rewards-${name}.csv file either not saved or corrupted file saved.`
              );
            } else {
              console.log(`Rewards-${name}.csv saved!`);
            }
          }
        );
      }
    );

    //multisender csv
    jsonexport(multisend, { includeHeaders: false }, function (err, csv) {
      if (err) return console.error(err);
      fs.writeFile(
        `Multisend/Multisend-${name}.csv`,
        csv,
        "utf8",
        function (err) {
          if (err) {
            console.log(
              `Some error occured - Multisend-${name}.csv file either not saved or corrupted file saved.`
            );
          } else {
            console.log(`Multisend-${name}.csv saved!`);
          }
        }
      );
    });
  }
};

main();
