import db from '../../../../db';
import Promise from 'bluebird';
import tsnejs from './tsne';
import { groupBy } from 'lodash';
import clustering from 'density-clustering';

export default async function(teamId, startDate = null, endDate = null, interval = '1 day') {
  console.log(`Getting FrequentSpeakers for ${teamId}, ${startDate}, ${endDate}`);

  const rawData = await db.any(`SELECT user_id, channel_id, is_member FROM membership WHERE team_id = $(teamId) AND user_id <> 'USLACKBOT' ORDER BY user_id, channel_id;`,
    {
      teamId,
    });

  const groupedByUser = groupBy(rawData, row => row.user_id);

  const opt = {
    epsilon: 50, // epsilon is learning rate (10 = default)
    perplexity: 100, // roughly how many neighbors each point influences (30 = default)
    dim: 2, // dimensionality of the embedding (2 = default)
  };

  const tsne = new tsnejs.tSNE(opt); // create a tSNE instance
  const userIds = Object.keys(groupedByUser);
  const dists = userIds.map(key => {
    const result = groupedByUser[key].map(row => row.is_member === true ? 2 : 1);
    return result;
  });

  // console.log(dists.slice(0, 3));
  tsne.initDataDist(dists);

  for(let k = 0; k < 1000; k++) {
    tsne.step(); // every time you call this, solution gets better
  }
  const members = await db.any(`SELECT * FROM members WHERE team_id=$(teamId) AND id <> 'USLACKBOT'`, {
    teamId,
  });

  const solution = tsne.getSolution();
  // console.log(solution.slice(0, 3));
  const dbscan = new clustering.DBSCAN();
  const clusters = dbscan.run(solution, 0.1, 2);
  const data = solution.map((row, i) => ({
    channelId: userIds[i],
    name: members.find(member => member.id === userIds[i]).real_name,
    x: row[0]*1000,
    y: row[1]*1000
  }));

  const colors = [
    'red',
    'green',
    'blue',
    'yellow',
    'grey',
    'violet',
  ];

  clusters.forEach((cluster, i) => {
    const name = `Group ${i+1}`;
    cluster.forEach(index => {
      data[index].group = name;
      data[index].color = colors[i];
    });
  });

  return {
    data,
    members,
  };
};