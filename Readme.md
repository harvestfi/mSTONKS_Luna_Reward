# mSTONKS reward generate script

Run the script

```
nodemon app
```

This script will generate

- Reward-_PoolName_.csv in the `Analyze` Directory. It's just for analyzation.
- Multisend-_PoolName_.csv in the `Multisend` Directory. It's for [MultiSender.app](http://multisender.app/)
- `last-reward-out.json` in `LastUpdated` directory.

The Staking transaction data comes from the etherscan api.
It calculates the reward amount from the **last updated time and block**(if you are running this script the first time, it would be the start time of a pool) to the **latest block** at the moment of running script.

Once you run this script, it will save the `lastBlock` and `lastBlockTimestamp` in the `last-reward-out.json` file.

And if you want to run this script again after a week, you have to change the file name of `last-reward-out.json` to `last-reward-in.json` so that the script can read the last updated data.
Otherwise, the reward amount would be incorrect.
