const express = require('express');
const bodyParser = require('body-parser');
const { sequelize, Op, QueryTypes } = require('./model')
const { getProfile } = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */
app.get('/contracts/:id', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const { id } = req.params
    const profile = req.profile;
    const contract = await Contract.findOne(
        {
            where:
            {
                id: id,
                [Op.or]: [
                    {
                        ClientId: profile.id
                    },
                    {
                        ContractorId: profile.id
                    }
                ]
            }
        })
    if (!contract) return res.status(404).end()
    res.json(contract)
});

app.get('/contracts', getProfile, async (req, res) => {
    const { Contract } = req.app.get('models')
    const profile = req.profile;
    const contract = await Contract.findAll(
        {
            where:
            {
                status: { [Op.ne]: 'terminated' },
                [Op.or]: [
                    {
                        ClientId: profile.id
                    },
                    {
                        ContractorId: profile.id
                    }
                ]
            }
        })
    if (!contract) return res.status(404).end()
    res.json(contract)
});

app.get('/jobs/unpaid', getProfile, async (req, res) => {
    const { Job, Contract } = req.app.get('models')
    const profile = req.profile;
    const Jobs = await Job.findAll(
        {
            include: [{
                model: Contract,
                where: {
                    status: { [Op.ne]: 'terminated' },
                    [Op.or]: [
                        {
                            ClientId: profile.id
                        },
                        {
                            ContractorId: profile.id
                        }
                    ]
                }
            }],
            where: { paid: null }
        })
    if (!Jobs) return res.status(404).end()
    res.json(Jobs)
});

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const profile = req.profile;
    const payment = req.get('payment');
    const { job_id } = req.params;
    let refundAmount = 0;

    if (profile.type !== 'client') {
        const message = { message: 'This profile can not pay. Because only clients can pay.' };
        return res.json(message);
    }
    if (profile.balance < payment) {
        const message = { message: 'Your balance is not enough for this payment...' };
        return res.json(message);
    }
    const JobItem = await Job.findOne(
        {
            include: [{
                model: Contract,
                where: {
                    status: { [Op.ne]: 'terminated' },
                    [Op.or]: [
                        {
                            ClientId: profile.id
                        },
                        {
                            ContractorId: profile.id
                        }
                    ]
                }
            }],
            where: {
                id: job_id
            }
        });

    if (JobItem.price > payment) {
        const message = { message: 'To close this job, you need to pay whole payment for this job...' };
        return res.json(message);
    }

    if (JobItem.price < payment) {
        refundAmount = payment - JobItem.price;
    }
    const updateResult = await Job.update({ paid: true }, { where: { id: job_id } });
    const client = await Profile.update({ balance: profile.balance - (payment - refundAmount) }, { where: { id: JobItem.Contract.ClientId } });
    const contractor = await Profile.update({ balance: profile.balance + (payment - refundAmount) }, { where: { id: JobItem.Contract.ContractorId } });

    if (!JobItem) return res.status(404).end()
    res.json(JobItem)
});

app.get('/balances/deposit/:userId', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models')
    const profile = req.profile;
    const payment = req.get('payment');
    const Jobs = await Job.findAll(
        {
            include: [{
                model: Contract,
                where: {
                    ClientId: profile.id
                }
            }],
            where: { paid: null }
        });

    const amount = Jobs.reduce(function (a, b) {
        return a.price + b.price;
    });

    if (payment > (amount * .25)) {
        const message = { message: 'Please make deposit less than 25% of total amount...' };
        return res.json(message);
    }

    await Profile.update({ balance: profile.balance + payment }, { where: { id: profile.id } });

    res.json({ message: 'Deposit payment is done...' });
});

app.get('/admin/best-profession', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const profile = req.profile;
    const query = req.query;

    let isValidStartDate = Date.parse(query.start);
    let isValidEndDate = Date.parse(query.end);

    if (isNaN(isValidStartDate) || isNaN(isValidEndDate)) {
        const message = { message: 'Please make sure to push valid date format...' };
        return res.json(message);
    }

    const result = await sequelize.query(`
        select 
            p.firstName
            ,p.lastName
            ,p.profession 
            , sum(j.price) as total_cost
        from Profiles as p 
        inner join Contracts as c on p.id = c.ContractorId
        inner join Jobs as j on j.ContractId = c.Id
        where DATE(p.createdAt) BETWEEN '${query.start}' AND '${query.end}'
        group by 
            p.firstName
            ,p.lastName
            ,p.profession 
        order by total_cost desc limit 1`, { type: QueryTypes.SELECT })
        .then(response => {
            return response && response[0];
        }).catch(err => {
            console.log(err)
        });;



    res.json({ result });
});

app.get('/admin/best-clients', getProfile, async (req, res) => {
    const { Job, Contract, Profile } = req.app.get('models');
    const profile = req.profile;
    const { start, end, limit = 2 } = req.query;

    let isValidStartDate = Date.parse(start);
    let isValidEndDate = Date.parse(end);

    if (isNaN(isValidStartDate) || isNaN(isValidEndDate)) {
        const message = { message: 'Please make sure to push valid date format...' };
        return res.json(message);
    }

    const result = await sequelize.query(`
        select 
            p.firstName
            ,p.lastName
            ,p.profession 
            , sum(j.price) as total_cost
        from Profiles as p 
        inner join Contracts as c on p.id = c.ClientId
        inner join Jobs as j on j.ContractId = c.Id
        where DATE(p.createdAt) BETWEEN '${start}' AND '${end}'
        group by 
            p.firstName
            ,p.lastName
            ,p.profession 
        order by total_cost desc limit ${limit}`, { type: QueryTypes.SELECT })
        .then(response => {
            return response;
        }).catch(err => {
            console.log(err)
        });;



    res.json({ result });
});

module.exports = app;
